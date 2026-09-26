import type { AgentDefinition } from '@anthropic-ai/claude-agent-sdk';
import { TEST_COVERAGE_ANALYZER_PROMPT } from '../prompts/index.js';

export const testCoverageAnalyzer: AgentDefinition = {
  description:
    'Analyzes pull request files for missing tests, untested paths, branches, edge cases, and test coverage gaps.',
  prompt: TEST_COVERAGE_ANALYZER_PROMPT,
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
