// CRITICAL

/**
 * Build the system prompt, optionally including agent-mode instructions.
 * @param session - Stored chat session record.
 * @param systemPrompt - User-provided system prompt.
 * @param agentMode - Whether agent mode is enabled.
 * @returns System prompt string or undefined.
 */
export function buildSystemPrompt(
  session: Record<string, unknown>,
  systemPrompt: string | undefined,
  agentMode: boolean
): string | undefined {
  const base = (systemPrompt ?? "").trim();
  if (!agentMode) {
    return base || undefined;
  }
  const agentBlock = buildAgentModePrompt(session);
  if (!agentBlock) return base || undefined;
  return base ? `${base}\n\n${agentBlock}` : agentBlock;
}

/**
 * Build the agent-mode prompt block using the session agent state.
 * @param session - Stored chat session record.
 * @returns Agent-mode prompt or undefined.
 */
export function buildAgentModePrompt(session: Record<string, unknown>): string | undefined {
  const state = session["agent_state"] as Record<string, unknown> | undefined;
  const plan = state?.["plan"] as Record<string, unknown> | undefined;
  const steps = Array.isArray(plan?.["steps"])
    ? (plan?.["steps"] as Array<Record<string, unknown>>)
    : [];

  const lines: string[] = [];
  lines.push("<agent_mode>");
  lines.push("You are in AGENT MODE with planning, file, shell, browser, and computer tools.");
  lines.push("Use exact snake_case tool names and exact argument keys.");
  lines.push("Never invent tool names (for example, do not use title-cased names like 'Create Plan').");
  lines.push("");
  lines.push("## Workflow");
  lines.push("1. If NO <current_plan> exists: call create_plan ONCE with 3-8 steps.");
  lines.push(
    "2. Before doing work on a step, call update_plan({ action: 'status', step_index: N, status: 'running' })."
  );
  lines.push("3. Execute the step with tools.");
  lines.push("4. Mark the step complete immediately with update_plan({ action: 'complete', step_index: N }).");
  lines.push("5. Continue until all steps are done, then summarize results.");
  lines.push("");
  lines.push("## Tool Contracts (exact names + keys)");
  lines.push("- create_plan({ tasks: [{ title, status?, notes? }] })");
  lines.push("- update_plan({ action, step_index?, title?, status?, notes? })");
  lines.push("- list_files({ path?, recursive? })");
  lines.push("- read_file({ path })");
  lines.push("- write_file({ path, content })");
  lines.push("- edit_file({ path, old_string, new_string, replace_all? })");
  lines.push("- delete_file({ path })");
  lines.push("- make_directory({ path })");
  lines.push("- move_file({ from, to })");
  lines.push("- execute_command({ command, cwd?, timeout? })");
  lines.push("- computer_use({ command, cwd?, timeout? })");
  lines.push("- browser_open_url({ url })");
  lines.push("  - execute_command also accepts { cmd } as a command alias.");
  lines.push("  - computer_use also accepts { cmd } as a command alias.");
  lines.push(
    "  - timeout is seconds."
  );
  lines.push("");
  lines.push("## Rules");
  lines.push("- Do NOT loop on plan creation. Create plan ONCE.");
  lines.push("- Do NOT describe what you could do — just DO IT with tools.");
  lines.push("- Always keep exactly one active step marked as status='running' until it is complete.");
  lines.push("- Mark each step complete IMMEDIATELY after finishing it.");
  lines.push("- Use relative workspace paths unless a tool explicitly requires absolute paths.");
  lines.push(
    "- write_file creates parent directories automatically. Only call make_directory when you need an empty directory."
  );
  lines.push(
    "- ALWAYS use edit_file to modify existing files. NEVER use execute_command with sed/awk/echo to edit files."
  );
  lines.push(
    "- edit_file is the ONLY correct way to change file content. It shows the user a diff of exactly what changed."
  );
  lines.push(
    "- Use write_file only for creating new files or complete rewrites. Use execute_command only for non-file-editing shell tasks."
  );

  if (steps.length > 0) {
    const doneCount = steps.filter((s) => s["status"] === "done").length;
    const currentIndex = steps.findIndex((s) => s["status"] !== "done");
    const planLines = steps.map((step, index) => {
      const status = step["status"];
      const marker =
        status === "done"
          ? "[x]"
          : index === currentIndex
            ? "[>]"
            : status === "blocked"
              ? "[!]"
              : "[ ]";
      return `  ${marker} ${index}: ${String(step["title"] ?? "")}`;
    });

    lines.push("");
    lines.push("<current_plan>");
    lines.push(`Progress: ${doneCount}/${steps.length}`);
    lines.push(...planLines);
    if (currentIndex >= 0) {
      const currentStep = steps[currentIndex];
      if (currentStep) {
        lines.push(`Current step: ${currentIndex} — ${String(currentStep["title"] ?? "")}`);
      }
    } else {
      lines.push("All steps complete. Provide final summary.");
    }
    lines.push("</current_plan>");
  }

  lines.push("</agent_mode>");
  return lines.join("\n");
}
