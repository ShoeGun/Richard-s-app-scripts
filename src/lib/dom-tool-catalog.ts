export type DomToolRisk = 'page-local' | 'user-confirmation' | 'server-broker';

export type DomToolDefinition = {
  id: string;
  argumentSyntax: string;
  implementationId: string;
  risk: DomToolRisk;
  description: string;
  enabled: boolean;
};

// This is the trusted local catalog. A remote sheet may describe tools, but it
// must never replace these implementation IDs with executable source code.
export const DOM_TOOL_CATALOG: DomToolDefinition[] = [
  {
    id: 'dom.fireworks',
    argumentSyntax: 'none',
    implementationId: 'dom.fireworks',
    risk: 'page-local',
    description: 'Show the portfolio fireworks effect.',
    enabled: true
  },
  {
    id: 'dom.hotdog_rain',
    argumentSyntax: 'none',
    implementationId: 'dom.hotdog_rain',
    risk: 'page-local',
    description: 'Show a temporary hotdog rain overlay over the portfolio.',
    enabled: true
  },
  {
    id: 'dom.face.animate',
    argumentSyntax: 'sequence?: curious|happy|wonder|thinking|celebrate[]',
    implementationId: 'dom.face.animate',
    risk: 'page-local',
    description: 'Animate Dom\'s chart face with an approved mood sequence.',
    enabled: true
  },
  {
    id: 'dom.focus_sheet',
    argumentSyntax: 'url?: public Google Sheet URL',
    implementationId: 'dom.focus_sheet',
    risk: 'page-local',
    description: 'Focus the public-sheet input and optionally place a supplied URL into it.',
    enabled: true
  },
  {
    id: 'consultation.open',
    argumentSyntax: 'none',
    implementationId: 'consultation.open',
    risk: 'user-confirmation',
    description: 'Open the consultation options without creating an appointment.',
    enabled: false
  },
  {
    id: 'notify.send_text',
    argumentSyntax: 'number: string, message: string',
    implementationId: 'notify.send_text',
    risk: 'server-broker',
    description: 'Request a text through an authenticated notification broker.',
    enabled: false
  }
];

export function getDomTool(toolId: string) {
  return DOM_TOOL_CATALOG.find((tool) => tool.enabled && tool.id === toolId) || null;
}

export function toolCatalogRow(tool: DomToolDefinition) {
  return [tool.id, tool.argumentSyntax, tool.implementationId, tool.risk, tool.description].join(' | ');
}

export function toolCatalogPrompt(toolId: string) {
  const tool = getDomTool(toolId);
  return tool ? toolCatalogRow(tool) : '';
}
