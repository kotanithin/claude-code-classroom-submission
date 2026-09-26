import { query } from '@anthropic-ai/claude-agent-sdk';

import {
  codeQualityAnalyzer,
  testCoverageAnalyzer,
  refactoringSuggester
} from './agents/index.js';

import { mcpServersConfig } from './config/mcp.config.js';

import {
  ReviewReport,
  ReviewReportSchema,
  ReviewReportJSONSchema
} from './types/index.js';

import {
  buildOrchestratorPrompt
} from './prompts/index.js';

import {
  ReviewError,
  ErrorCodes,
  withTimeout
} from './utils/index.js';

import {
  logger
} from './utils/index.js';

/**
 * Configuration options for the Code Review Orchestrator.
 */
export interface OrchestratorOptions {
  /**
   * Claude model to use.
   */
  model?: string;

  /**
   * Maximum number of turns available to the orchestrator.
   */
  maxTurns?: number;

  /**
   * Maximum execution time for a review.
   */
  timeoutMs?: number;
}

/**
 * Main Code Review Orchestrator.
 *
 * The orchestrator:
 *
 * 1. Connects to the GitHub and ESLint MCP servers.
 * 2. Registers the three specialized review agents.
 * 3. Gives the lead agent responsibility for coordinating the review.
 * 4. Requires the final result to conform to ReviewReportJSONSchema.
 * 5. Validates the returned result again using Zod.
 */
export class CodeReviewOrchestrator {
  private readonly model: string;
  private readonly maxTurns: number;
  private readonly timeoutMs: number;

  constructor(options: OrchestratorOptions = {}) {
    this.model =
      options.model ||
      process.env.ANTHROPIC_MODEL ||
      'claude-sonnet-4-5';

    this.maxTurns = options.maxTurns ?? 30;
    this.timeoutMs = options.timeoutMs ?? 600_000;
  }

  /**
   * Review a pull request using the three specialized subagents.
   */
  async reviewPullRequest(
    owner: string,
    repo: string,
    prNumber: number
  ): Promise<ReviewReport> {
    const startedAt = Date.now();

    logger.info('Starting pull request review', {
      owner,
      repo,
      prNumber,
      model: this.model
    });

    const prompt = buildOrchestratorPrompt(
      owner,
      repo,
      prNumber
    );

    const reviewPromise = this.executeReview(
      prompt,
      owner,
      repo,
      prNumber
    );

    try {
      const report = await withTimeout(
        () => reviewPromise,
        this.timeoutMs,
        ErrorCodes.AGENT_TIMEOUT
      );

      const duration = Date.now() - startedAt;

      const finalReport: ReviewReport = {
        ...report,
        metadata: {
          ...report.metadata,
          analyzedAt:
            report.metadata?.analyzedAt ||
            new Date().toISOString(),
          duration
        }
      };

      const validated =
        ReviewReportSchema.safeParse(finalReport);

      if (!validated.success) {
        logger.error(
          'Review report failed final Zod validation',
          {
            errors: validated.error.issues
          }
        );

        throw new ReviewError(
          'Generated review report failed schema validation.',
          ErrorCodes.AGENT_FAILED
        );
      }

      logger.info(
        'Pull request review completed',
        {
          owner,
          repo,
          prNumber,
          duration,
          filesReviewed:
            validated.data.summary.totalFiles
        }
      );

      return validated.data;
    } catch (error) {
      if (error instanceof ReviewError) {
        throw error;
      }

      logger.error(
        'Pull request review failed',
        {
          owner,
          repo,
          prNumber,
          error:
            error instanceof Error
              ? error.message
              : String(error)
        }
      );

      throw new ReviewError(
        `Pull request review failed: ${
          error instanceof Error
            ? error.message
            : String(error)
        }`,
        ErrorCodes.AGENT_FAILED
      );
    }
  }

  /**
   * Execute the Claude Agent SDK review.
   */
  private async executeReview(
    prompt: string,
    owner: string,
    repo: string,
    prNumber: number
  ): Promise<ReviewReport> {
    const agents = {
      'code-quality-analyzer': codeQualityAnalyzer,
      'test-coverage-analyzer': testCoverageAnalyzer,
      'refactoring-suggester': refactoringSuggester
    };

    const fullPrompt = `
${prompt}

IMPORTANT EXECUTION REQUIREMENTS

Repository:
${owner}/${repo}

Pull request:
#${prNumber}

You are the lead review orchestrator.

First retrieve the pull request information and changed files
using the GitHub MCP server.

Then delegate the analysis to ALL THREE specialized agents:

1. code-quality-analyzer
2. test-coverage-analyzer
3. refactoring-suggester

The three analyses are independent and should be performed
in parallel whenever possible.

Each specialized agent must analyze the relevant changed
files and return structured findings.

After all three analyses are complete:

1. Match the results by file.
2. Combine the three analyses for every changed file.
3. Calculate the report summary.
4. Create actionable recommendations.
5. Do not invent findings, files, line numbers, or coverage data.
6. Preserve important findings from all three agents.
7. Return ONLY the final ReviewReport structure requested by
   the JSON schema.

The final report must contain:

- pullRequest
- fileReviews
- summary
- recommendations
- metadata

The metadata.agentVersions object should identify the three
specialized agents used during the review.
`;

    logger.info(
      'Launching Claude review orchestrator',
      {
        agents: Object.keys(agents),
        mcpServers: Object.keys(mcpServersConfig)
      }
    );

    const result = query({
      prompt: fullPrompt,

      options: {
        model: this.model,

        maxTurns: this.maxTurns,

        mcpServers: mcpServersConfig,

        agents,

        allowedTools: [
          'Task',
          'Read',
          'Grep',
          'Glob',
          'mcp__github__get_pull_request',
          'mcp__github__get_pull_request_files',
          'mcp__github__get_file_contents',
          'mcp__eslint__lint'
        ],

        outputFormat: {
          type: 'json_schema',
          schema: ReviewReportJSONSchema
        }
      }
    });

    let structuredOutput: unknown = undefined;
    let lastAssistantText = '';

    for await (const message of result as AsyncIterable<any>) {
      /*
       * The Agent SDK can expose structured output on the
       * final result message. Keep the extraction defensive
       * because different SDK message versions can expose
       * it slightly differently.
       */

      if (
        message &&
        typeof message === 'object'
      ) {
        if (
          message.structured_output !== undefined
        ) {
          structuredOutput =
            message.structured_output;
        }

        if (
          message.structuredOutput !== undefined
        ) {
          structuredOutput =
            message.structuredOutput;
        }

        if (
          typeof message.result === 'string'
        ) {
          lastAssistantText =
            message.result;
        }

        if (
          message.result &&
          typeof message.result === 'object'
        ) {
          if (
            message.result.structured_output !==
            undefined
          ) {
            structuredOutput =
              message.result.structured_output;
          }

          if (
            message.result.structuredOutput !==
            undefined
          ) {
            structuredOutput =
              message.result.structuredOutput;
          }
        }
      }
    }

    /*
     * Some SDK versions expose the structured result as JSON
     * text rather than a parsed object. Handle that case too.
     */
    if (
      structuredOutput === undefined &&
      lastAssistantText
    ) {
      try {
        structuredOutput =
          JSON.parse(lastAssistantText);
      } catch {
        // The Zod validation below will produce the useful error.
      }
    }

    if (structuredOutput === undefined) {
      throw new ReviewError(
        'Claude did not return a structured review report.',
        ErrorCodes.AGENT_FAILED
      );
    }

    const validation =
      ReviewReportSchema.safeParse(
        structuredOutput
      );

    if (!validation.success) {
      logger.error(
        'Claude returned an invalid ReviewReport',
        {
          errors: validation.error.issues
        }
      );

      throw new ReviewError(
        'Claude returned a review report that does not match the required schema.',
        ErrorCodes.AGENT_FAILED
      );
    }

    return validation.data;
  }
}
