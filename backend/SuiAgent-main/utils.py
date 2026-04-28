
import re
import json
import logging
from typing import Dict, Any, List, Tuple, Optional


def pretty_print_trajectory(messages: List[dict], show_full_content: bool = False, print_to_terminal: bool = True):
    output_lines = []

    def colored(text, color):
        COLORS = {
            "user": "\033[96m",
            "assistant": "\033[92m",
            "system": "\033[95m",
            "end": "\033[0m",
        }
        return COLORS.get(color, "") + text + COLORS["end"]

    if print_to_terminal:
        print()
    output_lines.append("")

    for idx, msg in enumerate(messages):
        role = msg.get("role", "")
        if role not in ("system", "user", "assistant"):
            continue
        role_disp = colored(f"{'=' * 50} {role.upper()} MESSAGE {'=' * 50}", role)
        line_header = f"{idx + 1:02d}. | {role_disp}"
        plain_line_header = f"{idx + 1:02d}. | {'=' * 50} {role.upper()} MESSAGE {'=' * 50}"

        if print_to_terminal:
            print(line_header)
        output_lines.append(plain_line_header)

        content = msg["content"][0]["text"]
        if isinstance(content, str) and not show_full_content and len(content) > 500:
            preview = content[:250] + "\n ... [Collapsed] ... \n" + content[-250:]
            if print_to_terminal:
                print(preview)
            output_lines.append(preview)
        else:
            if print_to_terminal:
                print(content)
            output_lines.append(content)
    if print_to_terminal:
        print()
    output_lines.append("")

    return "\n".join(output_lines)

def dict_to_outline_str(d: dict, indent: int = 2) -> str:
    """
    Note: This function can handle up to two levels of nested dicts
    """
    lines = []
    for k, v in d.items():
        if isinstance(v, dict):
            lines.append(str(k))
            for sub_k in v.keys():
                lines.append(" " * indent + f"- {sub_k}")
        elif isinstance(v, list):
            lines.append(str(k))
            for sub_k in v:
                lines.append(" " * indent + f"- {sub_k}")
        else:
            lines.append(f"{k}: {v}")
    return "\n".join(lines)

def deep_update(d: dict, u: dict):
    for k, v in u.items():
        if isinstance(v, dict) and k in d and isinstance(d[k], dict):
            deep_update(d[k], v)
        else:
            d[k] = v

def create_message(role: str, text: str) -> dict:
    allowed_roles = {"system", "user", "assistant"}
    if role not in allowed_roles:
        raise ValueError(f"role must be one of {allowed_roles}，but received '{role}'")
    return {"role": role, "content": [{"type": "text", "text": text}]}

def remove_python_code_in_the_history(text: str) -> str:
    pattern = re.compile(
        r"(<code>)(.*?)(</code>)",
        re.DOTALL | re.IGNORECASE
    )
    return pattern.sub(r"\1[SYSTEM INFO: History python code removed for brevity]\3", text)

def remove_accessibility_tree_in_the_history(text: str) -> str:
    pattern = re.compile(
        r"(<webpage accessibility tree>)(.*?)(</webpage accessibility tree>)",
        re.DOTALL | re.IGNORECASE
    )
    return pattern.sub(r"\1[SYSTEM INFO: History accessibility tree removed for brevity]\3", text)

def remove_browser_state_in_the_history(text: str) -> str:
    pattern = re.compile(
        r"(<webpage interactive elements>)(.*?)(</webpage interactive elements>)",
        re.DOTALL | re.IGNORECASE
    )
    return pattern.sub(r"\1[SYSTEM INFO: History interactive elements removed for brevity]\3", text)

def extract_json_codeblock(md_text: str, debug: bool = False) -> Tuple[Dict[str, Any], Optional[str]]:
    match = re.search(r"```json[^\n]*\r?\n(.*?)\r?\n?```", md_text, re.DOTALL | re.IGNORECASE)
    if not match:
        msg = "❌ extract_json_codeblock: can't find json block"
        logging.error(msg)
        return {}, msg

    block = match.group(1).strip()
    try:
        result, error = safe_json_parse(block, debug=debug)
    except Exception as e:
        msg = f"❌ extract_json_codeblock: safe_json_parse crashed: {e}"
        logging.exception(msg)
        return {}, msg

    if isinstance(result, dict):
        return result, None

    msg = "❌ extract_json_codeblock: failed to parse JSON block"
    detail = error if error else f"Parsed result isn't dict (got {type(result).__name__})"
    logging.error("%s\n↳ Error detail: %s\n↳ (block excerpt, first 200 chars): %r",
                  msg, detail, block[:200])
    return {}, detail

def safe_json_parse(json_text: str, debug: bool = False) -> Tuple[Optional[dict], Optional[str]]:
    """
    Attempts to parse a JSON string. Automatically fixes common errors and returns a dictionary of results.
    On failure, returns None and a detailed error message (which will not include the full original text).
    """
    try:
        parsed_obj = json.loads(json_text)
        return parsed_obj, None
    except Exception as e:
        error_message = f"❌ Failed to parse JSON: {str(e)}"
        if debug:
            print(f"[DEBUG] json parse failure: {e}")
        return None, error_message