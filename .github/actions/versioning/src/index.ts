import { getInput, setFailed, info } from "@actions/core";
import { getOctokit, context } from "@actions/github";
import { execSync } from "child_process";

type Increment = "MAJOR" | "MINOR" | "PATCH";

function fetchTags() {
  try {
    execSync("git fetch --tags");
  } catch (error) {
    setFailed(`Failed to fetch tags: ${(error as Error).message}`);
  }
}

function getCurrentVersion(): string {
  try {
    const tag = execSync("git tag --sort=-v:refname | head -n 1")
      .toString()
      .trim();
    return tag;
  } catch (error) {
    return "v0.1.0";
  }
}

function getNextVersion(
  currentVersion: string,
  incrementType: Increment
): string {
  const versionParts = currentVersion.replace(/^v/, "").split(".").map(Number);
  if (versionParts.length !== 3) {
    throw new Error("Invalid version format. Expected format: vX.Y.Z");
  }

  let [major, minor, patch] = versionParts;

  switch (incrementType) {
    case "MAJOR":
      major += 1;
      minor = 0;
      patch = 0;
      break;
    case "MINOR":
      minor += 1;
      patch = 0;
      break;
    case "PATCH":
      patch += 1;
      break;
    default:
      throw new Error(
        "Invalid increment type. Expected 'MAJOR', 'MINOR', or 'PATCH'."
      );
  }
  return `v${major}.${minor}.${patch}`;
}

function categorizeCommitMessages(
  commitMessage: string,
  minorPrefixes: string[] = ["feat"],
  patchPrefixes: string[] = ["fix"]
) {
  const minorRegex = new RegExp(
    `^(\\* )?(${minorPrefixes.join("|")})(?:\\([^)]+\\))?!?: (.+)`,
    "gm"
  );
  const patchRegex = new RegExp(
    `^(\\* )?(${patchPrefixes.join("|")})(?:\\([^)]+\\))?!?: (.+)`,
    "gm"
  );

  const majorMessages: string[] = [];
  const minorMessages: string[] = [];
  const patchMessages: string[] = [];

  let match;
  while ((match = minorRegex.exec(commitMessage)) !== null) {
    const isBreaking = match[0].includes("!");
    if (isBreaking) {
      majorMessages.push(match[3]);
    } else {
      minorMessages.push(match[3]);
    }
  }

  while ((match = patchRegex.exec(commitMessage)) !== null) {
    const isBreaking = match[0].includes("!");
    if (isBreaking) {
      majorMessages.push(match[3]);
    } else {
      patchMessages.push(match[3]);
    }
  }

  return { majorMessages, minorMessages, patchMessages };
}
function generateReleaseNotes(
  majorMessages: string[],
  minorMessages: string[],
  patchMessages: string[],
  nextVersion: string
) {
  let releaseNotes = `## Release ${nextVersion}\n\n`;

  if (majorMessages.length > 0) {
    releaseNotes += "### BREAKING CHANGES:\n";
    majorMessages.forEach((msg) => (releaseNotes += `- ${msg}\n`));
  }

  if (minorMessages.length > 0) {
    releaseNotes += "### MAJOR CHANGES:\n";
    minorMessages.forEach((msg) => (releaseNotes += `- ${msg}\n`));
  }

  if (patchMessages.length > 0) {
    releaseNotes += "### MINOR CHANGES:\n";
    patchMessages.forEach((msg) => (releaseNotes += `- ${msg}\n`));
  }

  return releaseNotes;
}

async function run() {
  const token = getInput("gh-token");

  const octokit = getOctokit(token);
  const pullRequest = context.payload.pull_request;

  fetchTags();
  try {
    if (!pullRequest) {
      throw new Error("This action can only be run on Pull Request");
    }
    if (!pullRequest?.merged) {
      throw new Error("This action should only run after a PR is merged");
    }

    const { owner, repo } = context.repo;
    const latestCommitSha = context.sha;

    const { data: commitData } = await octokit.rest.git.getCommit({
      owner,
      repo,
      commit_sha: latestCommitSha,
    });

    const commitMessage = commitData.message;
    const { majorMessages, minorMessages, patchMessages } =
      categorizeCommitMessages(commitMessage);

    let versionIncrementType: Increment | null = null;
    if (majorMessages.length) {
      versionIncrementType = "MAJOR";
    } else if (minorMessages.length) {
      versionIncrementType = "MINOR";
    } else if (patchMessages.length) {
      versionIncrementType = "PATCH";
    }

    if (versionIncrementType === null) {
      throw new Error("Pull request does not contain correct commit messages");
    }

    const currentVersion = getCurrentVersion();
    info(`Current Application Version: ${currentVersion}`);
    const nextVersion = getNextVersion(currentVersion, versionIncrementType);
    info(`Next Application Version: ${nextVersion}`);

    const releaseNotes = generateReleaseNotes(
      majorMessages,
      minorMessages,
      patchMessages,
      nextVersion
    );
    info(releaseNotes);
    const createTagResponse = await octokit.rest.git.createTag({
      owner,
      repo,
      tag: nextVersion,
      message: releaseNotes,
      object: context.sha,
      type: "commit",
    });

    await octokit.rest.git.createRef({
      owner,
      repo,
      ref: `refs/tags/${nextVersion}`,
      sha: createTagResponse.data.sha,
    });
  } catch (error) {
    setFailed((error as Error)?.message ?? "Unknown error");
  }
}

run();
