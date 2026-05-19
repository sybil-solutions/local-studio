import { describe, expect, it } from "vitest";
import {
  attachmentDedupKey,
  attachmentPrompt,
  createAttachment,
  filesFromDataTransfer,
  isImageAttachment,
} from "./chat-attachments";

describe("chat attachments", () => {
  it("dedupes one pasted file exposed through files and items", () => {
    const first = new File(["same image"], "image.png", {
      type: "image/png",
      lastModified: 1,
    });
    const second = new File(["same image"], "image.png", {
      type: "image/png",
      lastModified: 2,
    });
    const transfer = {
      types: ["Files"],
      files: [first],
      items: [{ kind: "file", getAsFile: () => second }],
    } as unknown as DataTransfer;

    expect(filesFromDataTransfer(transfer)).toEqual([first]);
  });

  it("uses stable attachment keys and identifies inline image previews", () => {
    expect(
      attachmentDedupKey({
        name: "Image.PNG",
        type: "image/png",
        size: 123,
      }),
    ).toBe("file:image.png:image/png:123");
    expect(
      isImageAttachment({
        type: "image/png",
        mode: "data-url",
        content: "data:image/png;base64,abc",
      }),
    ).toBe(true);
  });

  it("keeps PDFs out of data-url prompt payloads", async () => {
    const attachment = await createAttachment(
      new File(["%PDF-1.7"], "paper.pdf", { type: "application/pdf" }),
    );

    expect(attachment.mode).toBe("metadata");
    expect(attachment.previewKind).toBe("pdf");
    expect(attachmentPrompt([attachment])).not.toContain("data:");
  });
});
