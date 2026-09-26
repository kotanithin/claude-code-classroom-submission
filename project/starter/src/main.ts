import * as dotenv from 'dotenv';
import { mkdir, writeFile } from 'node:fs/promises';

import { CodeReviewOrchestrator } from './orchestrator.js';
import {
  ReportGenerator,
  formatError,
  ErrorCodes,
  ReviewError,
  logger
} from './utils/index.js';

dotenv.config();

function printUsage(): void {
  console.error(
    '\nUsage:\n' +
    '  npm run dev <owner> <repo> <pr-number>\n\n' +
    'Example:\n' +
    '  npm run dev facebook react 12345\n'
  );
}

function validateArguments(
  owner: string | undefined,
  repo: string | undefined,
  prStr: string | undefined
): number {
  if (!owner || !repo || !prStr) {
    printUsage();

    throw new ReviewError(
      'Missing required command-line arguments',
      ErrorCodes.INVALID_CONFIG
    );
  }

  if (!/^[A-Za-z0-9_.-]+$/.test(owner)) {
    throw new ReviewError(
      `Invalid repository owner: ${owner}`,
      ErrorCodes.INVALID_CONFIG
    );
  }

  if (!/^[A-Za-z0-9_.-]+$/.test(repo)) {
    throw new ReviewError(
      `Invalid repository name: ${repo}`,
      ErrorCodes.INVALID_CONFIG
    );
  }

  const prNumber = Number(prStr);

  if (!Number.isInteger(prNumber) || prNumber <= 0) {
    throw new ReviewError(
      `Invalid pull request number: ${prStr}`,
      ErrorCodes.INVALID_CONFIG
    );
  }

  return prNumber;
}

function validateAuthentication(): void {
  const anthropicApiKey = process.env.ANTHROPIC_API_KEY;

  const awsAccessKey = process.env.AWS_ACCESS_KEY_ID;
  const awsSecret = process.env.AWS_SECRET_ACCESS_KEY;

  const usingAnthropic = Boolean(anthropicApiKey);
  const usingBedrock = Boolean(awsAccessKey && awsSecret);

  if (!usingAnthropic && !usingBedrock) {
    throw new ReviewError(
      'No authentication configured. Configure ANTHROPIC_API_KEY or AWS_ACCESS_KEY_ID + AWS_SECRET_ACCESS_KEY.',
      ErrorCodes.MISSING_API_KEY
    );
  }

  if (usingBedrock && !usingAnthropic) {
    if (!process.env.AWS_REGION) {
      throw new ReviewError(
        'AWS_REGION is required when using AWS Bedrock authentication.',
        ErrorCodes.INVALID_CONFIG
      );
    }

    logger.info('🔐 Using AWS Bedrock authentication');
    return;
  }

  logger.info('🔐 Using Anthropic API authentication');
}

function validateModel(): string {
  const model = process.env.ANTHROPIC_MODEL;

  if (!model || model.trim() === '') {
    throw new ReviewError(
      'ANTHROPIC_MODEL is required.',
      ErrorCodes.INVALID_CONFIG
    );
  }

  return model;
}

async function generateReports(
  report: Parameters<ReportGenerator['generateMarkdownReport']>[0],
  directory: string
): Promise<void> {
  await mkdir(directory, { recursive: true });

  const generator = new ReportGenerator();

  const markdown = generator.generateMarkdownReport(report);
  const html = generator.generateHTMLReport(report);
  const json = generator.generateJSONReport(report);

  await Promise.all([
    writeFile(`${directory}/review.md`, markdown, 'utf-8'),
    writeFile(`${directory}/review.html`, html, 'utf-8'),
    writeFile(`${directory}/review.json`, json, 'utf-8')
  ]);

  logger.info('Reports generated successfully', {
    directory,
    files: [
      `${directory}/review.md`,
      `${directory}/review.html`,
      `${directory}/review.json`
    ]
  });
}

async function main(): Promise<void> {
  const [owner, repo, prStr] = process.argv.slice(2);

  try {
    const prNumber = validateArguments(owner, repo, prStr);

    validateAuthentication();

    const model = validateModel();

    logger.info('Starting multi-agent code review', {
      owner,
      repo,
      prNumber,
      model
    });

    const orchestrator = new CodeReviewOrchestrator({
      model
    });

    const report = await orchestrator.reviewPullRequest(
      owner!,
      repo!,
      prNumber
    );

    await generateReports(report, 'reports');

    logger.info('Code review completed successfully', {
      owner,
      repo,
      prNumber
    });

    console.log('\n✅ Code review completed successfully.');
    console.log('Reports generated in: ./reports/');
    console.log('  - reports/review.md');
    console.log('  - reports/review.html');
    console.log('  - reports/review.json\n');
  } catch (error) {
    logger.error('Code review failed', {
      error: formatError(error)
    });

    console.error(`\n❌ ${formatError(error)}\n`);

    process.exitCode = 1;
  }
}

void main();
