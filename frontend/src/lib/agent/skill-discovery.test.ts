import { mkdirSync, writeFileSync } from "node:fs";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { codexAppSkillSources, discoverSkills, loadSkillInstructions } from "./skill-discovery";

describe("discoverSkills", () => {
  it("discovers and normalizes skills from every configured source", async () => {
    const root = await mkdtemp(path.join(tmpdir(), "vllm-skill-discovery-"));
    try {
      const codexSkill = path.join(root, ".codex", "skills", "agent-browser");
      const piSkill = path.join(root, ".pi", "skills", "pi-skill");
      mkdirSync(codexSkill, { recursive: true });
      mkdirSync(piSkill, { recursive: true });
      writeFileSync(path.join(codexSkill, "SKILL.md"), "# agent browser\n");
      writeFileSync(path.join(piSkill, "SKILL.md"), "# pi skill\n");

      expect(
        discoverSkills([
          { source: "~/.codex", dir: path.join(root, ".codex") },
          { source: "~/.pi", dir: path.join(root, ".pi") },
        ]),
      ).toEqual([
        {
          id: "~/.codex:agent browser",
          name: "agent browser",
          source: "~/.codex",
          path: codexSkill,
        },
        {
          id: "~/.pi:pi skill",
          name: "pi skill",
          source: "~/.pi",
          path: piSkill,
        },
      ]);
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });

  it("deduplicates by normalized skill name with source priority", async () => {
    const root = await mkdtemp(path.join(tmpdir(), "vllm-skill-discovery-"));
    try {
      const first = path.join(root, "codex", "skills", "shared-skill");
      const second = path.join(root, "factory", "skills", "shared_skill");
      mkdirSync(first, { recursive: true });
      mkdirSync(second, { recursive: true });
      writeFileSync(path.join(first, "SKILL.md"), "# shared\n");
      writeFileSync(path.join(second, "SKILL.md"), "# shared\n");

      const rows = discoverSkills([
        { source: "~/.codex", dir: path.join(root, "codex") },
        { source: "~/.factory", dir: path.join(root, "factory") },
      ]);

      expect(rows).toHaveLength(1);
      expect(rows[0]).toMatchObject({ name: "shared skill", source: "~/.codex", path: first });
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });

  it("keeps plugin skill names attributable to their plugin", async () => {
    const root = await mkdtemp(path.join(tmpdir(), "vllm-skill-discovery-"));
    try {
      const browserSkill = path.join(
        root,
        ".codex",
        "plugins",
        "cache",
        "openai-bundled",
        "browser-use",
        "0.1.0",
        "skills",
        "browser",
      );
      mkdirSync(browserSkill, { recursive: true });
      writeFileSync(path.join(browserSkill, "SKILL.md"), "# browser\n");

      expect(
        discoverSkills([{ source: "~/.codex", dir: path.join(root, ".codex") }])[0],
      ).toMatchObject({
        name: "browser-use:browser",
        source: "~/.codex",
        path: browserSkill,
      });
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });

  it("includes bundled Codex app plugin skills as skill sources", () => {
    expect(codexAppSkillSources()).toContainEqual(
      expect.objectContaining({
        source: "openai-bundled",
        dir: expect.stringContaining("Codex.app/Contents/Resources/plugins/openai-bundled/plugins"),
      }),
    );
  });

  it("loads selected skill instructions only from configured roots", async () => {
    const root = await mkdtemp(path.join(tmpdir(), "vllm-skill-discovery-"));
    try {
      const skill = path.join(root, ".codex", "skills", "agent-browser");
      const outside = path.join(root, "outside");
      mkdirSync(skill, { recursive: true });
      mkdirSync(outside, { recursive: true });
      writeFileSync(path.join(skill, "SKILL.md"), "# agent-browser\nUse the browser.\n");
      writeFileSync(path.join(outside, "SKILL.md"), "# nope\n");

      const sources = [{ source: "~/.codex", dir: path.join(root, ".codex") }];
      expect(loadSkillInstructions(skill, sources)).toMatchObject({
        name: "agent browser",
        instructions: "# agent-browser\nUse the browser.",
      });
      expect(loadSkillInstructions(outside, sources)).toBeNull();
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });
});
