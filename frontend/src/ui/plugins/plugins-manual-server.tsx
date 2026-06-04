"use client";

import { EmptySafeNotice } from "../list";
import {
  SettingsActions,
  SettingsButton,
  SettingsGroup,
  SettingsInput,
  SettingsRow,
  SettingsTextarea,
} from "../settings";

export function ManualMcpServerPanel({
  open,
  name,
  command,
  args,
  tags,
  env,
  busy,
  onToggleOpen,
  onNameChange,
  onCommandChange,
  onArgsChange,
  onTagsChange,
  onEnvChange,
  onCancel,
  onSubmit,
}: {
  open: boolean;
  name: string;
  command: string;
  args: string;
  tags: string;
  env: string;
  busy: boolean;
  onToggleOpen: () => void;
  onNameChange: (value: string) => void;
  onCommandChange: (value: string) => void;
  onArgsChange: (value: string) => void;
  onTagsChange: (value: string) => void;
  onEnvChange: (value: string) => void;
  onCancel: () => void;
  onSubmit: () => void;
}) {
  return (
    <SettingsGroup
      title="Manual MCP server"
      description="Register any stdio MCP server by launch command, args, env, and tags."
      actions={
        <SettingsButton onClick={onToggleOpen}>{open ? "Close" : "Configure"}</SettingsButton>
      }
    >
      {open ? (
        <>
          <SettingsRow
            label="Name"
            control={
              <SettingsInput value={name} onChange={onNameChange} placeholder="My MCP server" />
            }
          />
          <SettingsRow
            label="Command"
            control={<SettingsInput value={command} onChange={onCommandChange} placeholder="npx" />}
          />
          <SettingsRow
            label="Arguments"
            control={
              <SettingsInput value={args} onChange={onArgsChange} placeholder="-y @scope/server" />
            }
          />
          <SettingsRow
            label="Tags"
            control={
              <SettingsInput value={tags} onChange={onTagsChange} placeholder="coding, api" />
            }
          />
          <SettingsRow
            label="Environment"
            control={
              <SettingsTextarea
                value={env}
                onChange={onEnvChange}
                placeholder={"API_KEY=...\nANOTHER=..."}
                rows={4}
                focusTone="info"
              />
            }
          />
          <SettingsActions>
            <SettingsButton onClick={onCancel}>Cancel</SettingsButton>
            <SettingsButton
              tone="primary"
              onClick={onSubmit}
              disabled={!name.trim() || !command.trim() || busy}
            >
              Add server
            </SettingsButton>
          </SettingsActions>
        </>
      ) : (
        <EmptySafeNotice>Use a command like `npx`, `uvx`, `node`, or `python`.</EmptySafeNotice>
      )}
    </SettingsGroup>
  );
}
