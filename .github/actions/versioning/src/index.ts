import { getInput, setFailed } from "@actions/core";
import { getOctokit, context } from "@actions/github";
import { execSync } from "child_process";

type Increment = "MAJOR" | "MINOR" | "PATCH";
function getVersionIncrementType(
  commitMessage: string,
  minorPrefixes: string[] = ["feat"],
  patchPrefixes: string[] = ["fix"]
): Increment | "NONE" {
  const minorRegex = new RegExp(
    `^(${minorPrefixes.join("|")})(?:\\([^)]+\\))?!?: .+`,
    "m"
  );
  const patchRegex = new RegExp(
    `^(${patchPrefixes.join("|")})(?:\\([^)]+\\))?!?: .+`,
    "m"
  );
  if (minorRegex.test(commitMessage) && commitMessage.includes("!")) {
    return "MAJOR";
  }
  if (patchRegex.test(commitMessage) && commitMessage.includes("!")) {
    return "MAJOR";
  }
  if (minorRegex.test(commitMessage)) {
    return "MINOR";
  }
  if (patchRegex.test(commitMessage)) {
    return "PATCH";
  }
  return "NONE";
}

function getCurrentVersion(): string {
  try {
    const tag = execSync("git describe --tags --abbrev=0").toString().trim();
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
        "Invalid increment type. Expected 'major', 'minor', or 'patch'."
      );
  }
  return `v${major}.${minor}.${patch}`;
}

async function run() {
  const token = getInput("gh-token");

  const octokit = getOctokit(token);
  const pullRequest = context.payload.pull_request;

  try {
    if (!pullRequest) {
      throw new Error("This action can only be run on Pull Request");
    }

    const { owner, repo } = context.repo;
    const pull_number = pullRequest.number;

    const { data: commitsData } = await octokit.rest.pulls.listCommits({
      owner,
      repo,
      pull_number,
    });

    if (commitsData.length !== 1) {
      throw new Error(
        "The pull request contains multiple commits. PR must be squashed"
      );
    }
    const commitMessage = commitsData[0].commit.message;
    const versionIncrementType = getVersionIncrementType(commitMessage);
    if (versionIncrementType === "NONE") {
      throw new Error("Pull request does not contain correct commit messages");
    }

    const currentVersion = getCurrentVersion();
    const nextVersion = getNextVersion(currentVersion, versionIncrementType);

    const createTagResponse = await octokit.rest.git.createTag({
      owner,
      repo,
      tag: nextVersion,
      message: `Release ${nextVersion}`,
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