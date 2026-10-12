//
// HTTP surface for the discovery listings the composer reads: skills and
// prompt templates. Moved verbatim from the Next route handlers — both walk
// directories on the machine the agent runs on, so a remote runtime must be
// the one answering.
//

import { discoverSkills, loadSkillInstructions } from "../skill-discovery";
import {
  discoverPromptTemplates,
  loadPromptTemplateInstructions,
} from "../prompt-templates-store";

export async function handleSkillsList(): Promise<Response> {
  return Response.json({ skills: discoverSkills() });
}

export async function handleSkillLoad(request: Request): Promise<Response> {
  const skillPath = new URL(request.url).searchParams.get("path") ?? "";
  const skill = skillPath ? loadSkillInstructions(skillPath) : null;
  if (!skill) return Response.json({ error: "Skill not found" }, { status: 404 });
  return Response.json({ skill });
}

export async function handlePromptTemplatesList(): Promise<Response> {
  return Response.json({ templates: discoverPromptTemplates() });
}

export async function handlePromptTemplateLoad(request: Request): Promise<Response> {
  const templatePath = new URL(request.url).searchParams.get("path") ?? "";
  const template = templatePath ? loadPromptTemplateInstructions(templatePath) : null;
  if (!template) return Response.json({ error: "Template not found" }, { status: 404 });
  return Response.json({ template });
}
