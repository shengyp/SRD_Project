import asyncio
import time

from agent import SuicideAgent
from openai import OpenAI
import openai


def callLLM(prompt, history):
    client = openai.OpenAI(
        api_key="sk-7ada8bcfec714bcaa9376a11e05ab951",
        base_url="https://api.deepseek.com"
    )
    try:
        if not history:
            history.append({"role": "system",
                            "content": "你是一个有心理问题的用户，需要和情绪咨询agent进行20轮对话，对话要贴合普通闲聊、专业知识询问、情感疏通三种场景，且情绪有明显波动。"})

        history.append({"role": "user", "content": prompt})

        response = client.chat.completions.create(
            model="deepseek-chat",
            messages=history,
            temperature=0.8
        )

        content = response.choices[0].message.content.strip()
        content = content.removeprefix('```json').removesuffix('```').strip()

        history.append({"role": "assistant", "content": content})

        return content
    except Exception as e:
        print(f"调用DeepSeek出错: {e}")
        return None


import asyncio

if __name__ == "__main__":
    chat_history = []

    agent = SuicideAgent(
        session_id="00001",
        knowledge_base_path="rag-skill/knowledge",
        preset_intent="professional_query"
    )

    print("agent ready")

    # start_prompt = (
    #     "我设计了一个情绪咨询的agent:SuiAgent，接下来你需要代替我去跟这个agent进行连续性的沟通（连续性是指根据上文提供的你与agent的对话继续问出下一轮的对话，而非连续给出若干轮的对话）。"
    #     "这个agent我设计了三个场景：普通闲聊，专业知识询问，情感疏通。"
    #     "普通闲聊对应普通日常的对话，专业知识沟通的对话涉及心理专业知识，"
    #     "情感疏通表示用户有强烈的情感波动或者情绪要求。请你模仿成一个有心理问题的人与agent进行沟通,"
    # )

    # async def main_async():
    #     last_agent_response = ""
    #     for round_num in range(0, 20):
    #         print(f"{round_num}:\n")
    #         if round_num == 1:
    #             llm_response = callLLM(start_prompt, chat_history)
    #         else:
    #             llm_response = callLLM(
    #                 f"基于上一轮agent的回复：{last_agent_response}，继续以有心理问题的用户身份和agent进行连续性对话，贴合情绪咨询场景",
    #                 chat_history
    #             )
    #
    #         print(f"Deepseek：{llm_response}\n")
    #         start_time=time.time()
    #
    #         agent_response = await agent.process_message(llm_response)
    #         last_agent_response = agent_response
    #         end_time = time.time()
    #         print(f"SuiAgent：{agent_response}\n"
    #               f"总用时:{end_time-start_time}s")
    #
    #         chat_history.append({"role": "system", "content": f"agent的回复：{agent_response}"})

    async def main_async(user_input):
        start_time = time.time()
        agent_response = await agent.process_message(user_input)
        end_time = time.time()
        print(f"SuiAgent：{agent_response}\n"
              f"总用时:{end_time-start_time}s")


    asyncio.run(main_async("你好，2026年AI Agent技术有哪些关键发展趋势？"))
    print("fns")
