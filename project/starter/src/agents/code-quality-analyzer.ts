import type { AgentDefinition } from '@anthropic-ai/claude-agent-sdk';
import { CODE_QUALITY_ANALYZER_PROMPT } from '../prompts/index.js';

export const codeQualityAnalyzer: AgentDefinition = {
  description:
    'Analyzes pull request files for security, bugs, performance, maintainability, style, and best-practice issues.',
  prompt: CODE_QUALITY_ANALYZER_PROMPT,
  model: 'inherit',
  mcpServers: ['github', 'eslint'],
  tools: [
    'Read',
    'Grep',
    'Glob',
    'mcp__github__get_file_contents',
    'mcp__github__get_pull_request',
    'mcp__eslint__lint'
  ]
};
