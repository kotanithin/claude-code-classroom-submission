import type { AgentDefinition } from '@anthropic-ai/claude-agent-sdk';
import { REFACTORING_SUGGESTER_PROMPT } from '../prompts/index.js';

export const refactoringSuggester: AgentDefinition = {
  description:
    'Identifies practical refactoring opportunities that improve readability, maintainability, simplicity, and design quality.',
  prompt: REFACTORING_SUGGESTER_PROMPT,
  model: 'inherit',
  mcpServers: ['github'],
  tools: [
    'Read',
    'Grep',
    'Glob',
    'mcp__github__get_file_contents',
    'mcp__github__get_pull_request',
  ]
};
