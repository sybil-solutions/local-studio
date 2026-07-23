#!/usr/bin/env python3
import argparse
import base64
import json
from concurrent.futures import ThreadPoolExecutor
from io import BytesIO
from pathlib import Path
from time import sleep
from urllib.error import HTTPError, URLError
from urllib.request import Request, urlopen

from datasets import load_dataset


PROMPT = (
    "Answer with the option letter from the given choices directly. The last line "
    "of your response should be of the following format: 'Answer: $LETTER' "
    "(without quotes) where LETTER is one of options."
)


def image_url(image):
    buffer = BytesIO()
    image.save(buffer, format="PNG")
    encoded = base64.b64encode(buffer.getvalue()).decode("ascii")
    return f"data:image/png;base64,{encoded}"


def ask(endpoint, model, image):
    payload = {
        "model": model,
        "temperature": 0,
        "chat_template_kwargs": {"enable_thinking": False},
        "messages": [
            {
                "role": "user",
                "content": [
                    {"type": "image_url", "image_url": {"url": image_url(image)}},
                    {"type": "text", "text": PROMPT},
                ],
            }
        ],
    }
    request = Request(
        f"{endpoint.rstrip('/')}/v1/chat/completions",
        data=json.dumps(payload).encode("utf-8"),
        headers={"Content-Type": "application/json"},
    )
    for attempt in range(4):
        try:
            with urlopen(request, timeout=600) as response:
                return json.loads(response.read())["choices"][0]["message"]["content"]
        except (HTTPError, TimeoutError, URLError, OSError):
            if attempt == 3:
                raise
            sleep(2**attempt)


def saved_ids(path):
    if not path.exists():
        return set()
    with path.open() as results:
        return {json.loads(line)["id"] for line in results if line.strip()}


def evaluate_sample(endpoint, model, sample):
    response = ask(endpoint, model, sample["image"])
    record = {key: sample[key] for key in ("id", "options", "answer", "subject")}
    record["response"] = response
    return record


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--endpoint", default="http://127.0.0.1:8000")
    parser.add_argument("--model", default="GLM-5.2-Vision")
    parser.add_argument(
        "--output",
        default="output/GLM-5.2-Vision_vision_direct.jsonl",
    )
    parser.add_argument("--limit", type=int)
    parser.add_argument("--workers", type=int, default=4)
    args = parser.parse_args()

    output = Path(args.output)
    output.parent.mkdir(parents=True, exist_ok=True)
    completed = saved_ids(output)
    dataset = load_dataset("MMMU/MMMU_Pro", "vision", split="test")
    written = 0
    samples = [sample for sample in dataset if sample["id"] not in completed]
    if args.limit is not None:
        samples = samples[: args.limit]
    with output.open("a", encoding="utf-8") as results:
        with ThreadPoolExecutor(max_workers=args.workers) as executor:
            for record in executor.map(
                lambda sample: evaluate_sample(args.endpoint, args.model, sample), samples
            ):
                results.write(json.dumps(record, ensure_ascii=False) + "\n")
                results.flush()
                written += 1
                print(f"completed={len(completed) + written} id={record['id']}", flush=True)


if __name__ == "__main__":
    main()
