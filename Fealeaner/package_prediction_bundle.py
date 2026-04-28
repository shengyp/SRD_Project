"""
将「最佳模型预测」所需代码打成独立目录，便于拷贝到其它机器或离线环境，
无需保留完整 FeaLearner 仓库（不含原始训练数据与特征工程脚本）。

生成目录结构（默认 prediction_bundle/）与仓库根目录一致，预测脚本仍通过
  FeaLearner/<dataset>/auto_select/（或兼容旧路径 <dataset>/auto_select/）
动态加载；打包时若存在 **FeaLearner/** 汇总目录则整包复制（与 Fealeaner 部署结构一致）。

用法：
  python package_prediction_bundle.py
  python package_prediction_bundle.py --output D:/deploy/my_predict

打包后请自行在输出目录旁（或目录内）准备：
  data/、feature_data/、bestmodel/
（或运行时通过命令行参数指定路径）
"""

from __future__ import annotations

import argparse
import shutil
import sys
from pathlib import Path

_SCRIPT_DIR = Path(__file__).resolve().parent
# 仓库根：含 FeaLearner/ 汇总目录的一层（脚本可在仓库根或 Fealeaner/ 子目录）
if (_SCRIPT_DIR / "FeaLearner").is_dir():
    _WORKSPACE = _SCRIPT_DIR
elif (_SCRIPT_DIR.parent / "FeaLearner").is_dir():
    _WORKSPACE = _SCRIPT_DIR.parent
else:
    _WORKSPACE = _SCRIPT_DIR

_DATASETS = ("weibo", "reddit", "bigdata", "sigir")
_PREDICT_SCRIPT = _SCRIPT_DIR / "predict_with_bestmodel.py"


def _src_auto_select(dataset: str) -> Path | None:
    """优先 FeaLearner 汇总目录，否则各子项目下 auto_select。"""
    bundled = _WORKSPACE / "FeaLearner" / dataset / "auto_select"
    if bundled.is_dir():
        return bundled
    legacy = _WORKSPACE / dataset / "auto_select"
    if legacy.is_dir():
        return legacy
    return None

_BUNDLE_README = """# 预测离线包说明

本目录由仓库根目录的 package_prediction_bundle.py 生成。

## 目录内容
- predict_with_bestmodel.py  预测入口
- FeaLearner/weibo|reddit|bigdata|sigir/auto_select/  各数据集模型代码（含 twomoe.py、tools/）

## 使用前请准备（与本目录同级，或自行传参）
- data/              各数据集 BERT 嵌入 pkl
- feature_data/      各数据集特征 csv
- bestmodel/         各数据集最佳权重 pth

默认文件名见 predict_with_bestmodel.py 顶部注释。

## 运行示例
cd 本目录
python predict_with_bestmodel.py --dataset weibo

依赖：Python 3.8+，已安装 numpy、pandas、torch、tqdm。
"""


def main() -> None:
    ap = argparse.ArgumentParser(description="打包预测所需代码到独立目录")
    ap.add_argument(
        "--output",
        type=Path,
        default=_WORKSPACE / "prediction_bundle",
        help="输出目录（默认：仓库根下 prediction_bundle/）",
    )
    ap.add_argument(
        "--clean",
        action="store_true",
        help="若输出目录已存在则先删除再打包",
    )
    args = ap.parse_args()
    out: Path = args.output.resolve()

    if not _PREDICT_SCRIPT.is_file():
        print(f"错误：找不到 {_PREDICT_SCRIPT}", file=sys.stderr)
        sys.exit(1)

    if out.exists():
        if args.clean:
            shutil.rmtree(out)
        else:
            print(f"错误：目录已存在 {out}，请加 --clean 或换 --output", file=sys.stderr)
            sys.exit(1)

    out.mkdir(parents=True, exist_ok=True)
    shutil.copy2(_PREDICT_SCRIPT, out / "predict_with_bestmodel.py")

    bundle_src = _WORKSPACE / "FeaLearner"
    if bundle_src.is_dir():
        shutil.copytree(bundle_src, out / "FeaLearner")
    else:
        missing: list[str] = []
        for ds in _DATASETS:
            src = _src_auto_select(ds)
            if src is None:
                missing.append(f"{ds}: FeaLearner/{ds}/auto_select 或 {ds}/auto_select")
                continue
            dst = out / ds / "auto_select"
            dst.parent.mkdir(parents=True, exist_ok=True)
            shutil.copytree(src, dst)
        if missing:
            print("警告：以下 auto_select 不存在，已跳过：", file=sys.stderr)
            for m in missing:
                print(f"  - {m}", file=sys.stderr)

    (out / "BUNDLE_README.txt").write_text(_BUNDLE_README, encoding="utf-8")
    print(f"已生成预测包: {out}")
    print("请将 data/、feature_data/、bestmodel/ 放到该目录（或与脚本约定路径一致）后运行 predict_with_bestmodel.py。")


if __name__ == "__main__":
    main()
