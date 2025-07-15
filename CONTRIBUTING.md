# Contributing to LivePlayer.js

First off, thank you for considering contributing to LivePlayer.js! We truly appreciate the community's efforts to help us improve.

To ensure a smooth and transparent development process for everyone, please read this guide carefully.

## Important: Our Development Workflow

Our primary development repository is hosted on an internal Gitea instance. This GitHub repository serves as a **public mirror** for visibility and community engagement.

Because of this setup, our workflow for handling contributions is slightly different from a typical GitHub project.

### Reporting Issues

You are welcome to **submit bug reports and feature requests** through the GitHub Issues tab. We monitor them actively.

When you open an issue, please provide as much detail as possible, including:
- A clear and descriptive title.
- Steps to reproduce the bug.
- Expected behavior vs. actual behavior.
- Your operating system and LivePlayer.js version.

We will review the issue and sync it with our internal tracking system.

### Submitting Pull Requests (PRs)

We are excited to accept contributions from the community! However, please note the following critical process:

**We DO NOT use the "Merge pull request" button on GitHub.**

Since this repository is a mirror, any commits made directly to the `main` branch on GitHub will be overwritten by our internal Gitea server. To ensure your contribution is properly integrated and credited, we follow a manual process:

1.  **Fork & Create a Branch**: Fork the repository, create a new branch for your changes, and commit your work there.
2.  **Open a PR**: Open a pull request from your fork to this repository's `main` branch. Please provide a clear description of the changes you've made.
3.  **Code Review**: Our team will review your code on GitHub. We may ask for changes or clarifications in the PR comments.
4.  **Manual Integration**: Once your PR is approved, one of our team members will:
    a. Fetch your changes from the PR branch to our local environment.
    b. Integrate your commits into our internal Gitea repository's `main` branch. We will make every effort to preserve your original commit authorship (see "Crediting Your Contribution" below).
    c. Push the updated `main` branch from our Gitea instance back to this GitHub repository.
5.  **Closing the PR**: After your commits appear in the `main` branch here on GitHub, we will close your original pull request with a comment linking to the commit(s) that contain your work.

We understand this is an extra step, and we thank you for your patience and understanding!

## Crediting Your Contribution

We believe in giving credit where it's due. When we manually integrate your commits, we will use `git` features to preserve you as the **original author** of the commit. Your GitHub username and email will appear in the commit history. The team member who performs the merge will be listed as the "committer."

This ensures that your contribution is a permanent and visible part of the project's history.

Thank you again for your contribution!