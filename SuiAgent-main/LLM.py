from openai import OpenAI

def callLLM(prompt):
    client = OpenAI(api_key="sk-7ada8bcfec714bcaa9376a11e05ab951", base_url="https://api.deepseek.com")
    try:
        response = client.chat.completions.create(
            model="deepseek-chat",
            messages=[
                {"role": "system", "content": "你是一个专业情绪咨询的助手。"},
                {"role": "user", "content": prompt}
            ],
        )
        content = response.choices[0].message.content.strip()
        return content.removeprefix('```json').removesuffix('```').strip()
    except Exception as e:
        return print(e)

if __name__ == "__main__":
    print(callLLM("你好"))