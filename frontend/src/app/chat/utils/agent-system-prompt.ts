import type { AgentPlan } from "@/app/chat/_components/agent/agent-types";

export function buildAgentModeSystemPrompt(plan: AgentPlan | null): string {
  const lines: string[] = [];

  lines.push("<agent_mode>");
  lines.push("You are in AGENT MODE. You have access to tools and MUST follow this workflow:");
  lines.push("");
  lines.push("1. If there is NO <current_plan>, call create_plan (alias: set_plan) exactly once to create a plan.");
  lines.push("2. If there IS a <current_plan>, do NOT call create_plan again unless the user asks to re-plan.");
  lines.push("3. Execute steps using available tools, updating progress with update_plan.");
  lines.push("4. Use list_files/read_file/write_file to manage files in the agent workspace.");
  lines.push("5. If a step is blocked, mark it \"blocked\" and move to the next feasible step.");
  lines.push("6. After all steps are done, provide a final summary of results.");
  lines.push("");
  lines.push("Plans should have 3–8 concrete, actionable steps.");
  lines.push("Do NOT loop on plan creation. Do NOT describe actions you could take — execute them.");

  if (plan?.steps?.length) {
    const steps = plan.steps;
    const doneCount = steps.filter((s) => s.status === "done").length;
    const currentIdx = steps.findIndex((s) => s.status !== "done");
    const planLines = steps.map((s, i) => {
      const marker = s.status === "done" ? "[x]" : i === currentIdx ? "[>]" : s.status === "blocked" ? "[!]" : "[ ]";
      return `  ${marker} ${i}: ${s.title}`;
    });

    lines.push("");
    lines.push("<current_plan>");
    lines.push(`Progress: ${doneCount}/${steps.length}`);
    lines.push(...planLines);
    if (currentIdx >= 0) lines.push(`Current step: ${currentIdx} — ${steps[currentIdx].title}`);
    else lines.push("All steps complete. Provide final summary.");
    lines.push("</current_plan>");
  }

  lines.push("</agent_mode>");
  return lines.join("\n");
}

