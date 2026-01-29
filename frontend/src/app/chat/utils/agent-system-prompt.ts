import type { AgentPlan } from "@/app/chat/_components/agent/agent-types";

export function buildAgentModeSystemPrompt(plan: AgentPlan | null): string {
  const lines: string[] = [];

  lines.push("<agent_mode>");
  lines.push("You are in AGENT MODE with access to planning and file tools.");
  lines.push("");
  lines.push("## Workflow");
  lines.push("1. If NO <current_plan> exists: call create_plan ONCE with 3-8 steps.");
  lines.push("2. Execute each step using tools. Mark steps done with update_plan({ action: 'complete', step_index: N }).");
  lines.push("3. For files: write_file creates parent directories automatically - no need for make_directory.");
  lines.push("4. Continue until all steps are done, then summarize results.");
  lines.push("");
  lines.push("## Tool Examples");
  lines.push("- create_plan({ tasks: [{ title: 'Research X' }, { title: 'Write report' }] })");
  lines.push("- update_plan({ action: 'complete', step_index: 0 })");
  lines.push("- write_file({ path: 'research/notes.md', content: '# Notes\\n...' })");
  lines.push("- read_file({ path: 'notes.md' })");
  lines.push("");
  lines.push("## Rules");
  lines.push("- Do NOT loop on plan creation. Create plan ONCE.");
  lines.push("- Do NOT describe what you could do — just DO IT with tools.");
  lines.push("- Mark each step complete IMMEDIATELY after finishing it.");

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

