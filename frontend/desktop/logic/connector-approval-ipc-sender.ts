export type ConnectorApprovalSenderInput = {
  currentFrontendUrl: string;
  mainWindow: object | null;
  quickPanelWindow: object | null;
  senderWindow: object | null;
  senderFrame: object | null;
  mainFrame: object | null;
  senderUrl: string;
  senderDestroyed: boolean;
  senderWindowDestroyed: boolean;
};

function origin(input: string): string | null {
  try {
    const value = new URL(input).origin;
    return value === "null" ? null : value;
  } catch {
    return null;
  }
}

export function allowsConnectorApprovalSender(input: ConnectorApprovalSenderInput): boolean {
  const expectedOrigin = origin(input.currentFrontendUrl);
  return (
    expectedOrigin !== null &&
    !input.senderDestroyed &&
    !input.senderWindowDestroyed &&
    input.senderWindow !== null &&
    (input.senderWindow === input.mainWindow || input.senderWindow === input.quickPanelWindow) &&
    input.senderFrame !== null &&
    input.senderFrame === input.mainFrame &&
    origin(input.senderUrl) === expectedOrigin
  );
}

export function allowsConnectorManagementSender(input: ConnectorApprovalSenderInput): boolean {
  return allowsConnectorApprovalSender({ ...input, quickPanelWindow: null });
}
