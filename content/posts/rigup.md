---
title: "Declarative, harness-agnostic agent skills with Nix"
date: 2026-07-02
tags:
  - ai
  - nix
---

It's been a while since I've posted anything on this blog. Today I'd like to promote a tool that my friend [@YPares](https://github.com/YPares)
has created, and which I've been daily driving for several months.

[Rigup](https://github.com/YPares/rigup.nix) is a Nix-based tool that allows you to bundle together instructions, knowledge, and executable programs
to form skills for your AI agent. These skills, called *riglets* in Rigup jargon, are not bound to a specific AI harness, and don't require that you
pollute your workspace with globally-installed programs.

## Yet another skill standard?

If you've used an AI coding agent for anything non-trivial, you probably know that agents can sometimes struggle at domain-specific work; and that *skills*
can greatly improve the agent's performance in such scenarios. A skill is just a set of instructions, references, and maybe a script or two that you hand to your agent so it knows *how* to do something properly; things like: *"how to write Nix flakes"* or *"how to format a report"* (using your, or your employer's preferred conventions). 

Skills are conceptually simple (at the end of the day, it's just about giving your LLM
the best tokens possible), but they can have a dramatic effect on the output. Even modest models punch way above their weight when they are given good instructions.

You are also perhaps already aware of how *fragmented* the AI-coding landscape is: a given model can be used across a large variety of harnesses (Claude Code, Opencode, Pi, Copilot CLI, Copilot inside VS Code, VS Code extensions, AI agents in Zed ... too many to count, really) and each of these harnesses has its own convention for how to inject instructions to the model: Cursor wants `.cursorrules`, Windsurf wants `.windsurfrules`, Claude Code has `CLAUDE.md` but also its own marketplace for skills etc. 

Meanwhile, a constellation of marketplace-like efforts—[SkillKit](https://skillkit.sh) ("write once, deploy to 46 AI coding agents"), [agentskills.io](https://agentskills.io/home) (a community spec + registry) are all circling the same question: **how do you bundle agent capabilities in a way that's portable across harnesses?**. [^1]

Rigup is a possible answer to that question. But instead of adding yet another YAML schema or ad-hoc folder convention to the pile, it implements this simple idea: **define your agent capabilities in Nix.**.
The same Nix that enables [reproducible dev environments](https://aige.eu/posts/reproducible-development-environments-with-nix-flakes/) , reproducible builds for your applications, [reproducible 
deployments for your infrastructure]({{< ref "posts/declarative-server-management-with-nix" >}}) can be used to build powerful and reproducible agentic coding environments too!

## Embracing Nix, embracing the CLI

In Rigup terminology, skills are called *riglets*, and agentic coding environments made of multiple riglets are called *rigs*.

A riglet bundles three things: documentation (the knowledge your agent needs), tools (the executables to act on that knowledge), and configuration (so those tools work out of the box). Because they are defined inside Nix flakes, every dependency is pinned and reproducible, and your agent can leverage the plethora of cross-platform executables available in Nixpkgs or public flakes on GitHub, without ever relying on globally-installed tools. 

Want a skill that lets your agent produce beautiful reports? Teach your agent how to use [Typst](https://typst.app/) and give it access to the `typst` CLI that's readily available in Nixpkgs. Here's what
the riglet would look like: 

```nix
_:
{ pkgs, ... }:
{
  config.riglets.typst-writer = {
    # CLI tools, made available to your agent, injected as absolute paths to the Nix store
    tools = [ pkgs.typst ];

    meta = {
      description = "Write correct and idiomatic Typst code for document typesetting";

      intent = "cookbook";

      # Trigger rules for this riglet, to help the model decide whether to read the skill
      # to achieve the task at hand
      whenToUse = [
        "Creating or editing Typst documents"
        "Understanding Typst syntax and features"
        "Generating PDFs with Typst"
        "Styling and bibliography in Typst"
      ];
      status = "stable";
      version = "0.1.0";
    };

    # A path to some documentation for the agent (a SKILL.md file and possibly other files)
    # to teach it how to properly use that CLI tool. Sitting right alongside your riglet definition, and committed with the rest
    # of your *rig*
    docs = ../typst-writer;
  };
}
```

This has a nice side effect: **riglets lean hard into the CLI as the substrate for agentic coding.** Your agent doesn't need a special protocol to talk to its tools. It just runs commands, the same ones you would run. Eric Holmes [made this case](https://ejholmes.github.io/2026/02/28/mcp-is-dead-long-live-the-cli.html) a few months ago, better than I ever could: CLIs are composable, debuggable, and both humans and LLMs already know how to use them. With Rigup, when a riglet bundles a tool, the agent sees the full absolute path from the Nix store (`/nix/store/.../bin/pandoc`), not some vague executable it has to hunt down on `$PATH`. 

At the same time, Rigup doesn't pretend CLI solves everything. The ecosystem of MCP servers is rich and growing, and sometimes, there's an MCP server that gives you exactly the tools you want. Wrapping an MCP server as a riglet is [straightforward](https://github.com/YPares/rigup.nix/blob/main/riglets/mcp-cased-kit.nix) you define the command, Nix provides the runtime (`python`, `node` or something else), you add
the riglet to your rig, and the MCP server shows up in your AI harness ... 

Actually wait a minute, how *do* they show up in your harness?

## Feeding rigs to your agent

Say you have defined a rig with a handful useful riglets, what can you *do* with it? 
We haven't yet discussed how rigs become the precious tokens that you feed into your agent to make it smarter. You don't want to feed Nix files directly to your agent, so what then?

Rigs are Nix derivations: you can build them, using the standard `nix build` command, or the `rigup build` command from the `rigup` CLI, and get something out of the build process. 
That *something* is what you want to inject in the context window of your model. 

```
# rigup build .
result/
├── RIG.md          # Auto-generated manifest — the agent's "table of contents"
├── bin/            # All tool executables (symlinks into the Nix store)
├── docs/           # Lazy-loadable documentation for each riglet
└── .config/        # Pre-merged tool configuration
```


The most important file that comes out of this build process is the `RIG.md` file.
It lists all the riglets the model can leverage, describes what each one is for, and when the agent must consult them; with the particularity that all paths in that file, pointing to executables
or to documentation files, are absolute paths to the nix store, so your agent always knows exactly where the things it needs are when it needs them.

The `RIG.md` file does not inline the entire content of every riglet. Instead, your agent uses it as an index file, and lazily pulls the full documentation it needs,
only when a riglet is relevant to the task at hand. This *progressive disclosure* keeps context usage lean, and rigup offers some options to configure exactly how much information is initially disclosed for
each riglet.

So, a possible workflow could be: build your rig, keep the result around, then at the very beginning of the conversation, before you ask anything else, tell your agent

> Read @/home/gbogard/rigs/result/RIG.md

and it would work reasonably well, but it wouldn't be very convenient. But rigup has another trick up its sleeve: **entrypoints**.

A riglet can have an *entrypoint*: a command that is executed when you run the `rigup run path_to_my_rig` command. The magic trick here is that this entrypoint command
can reference **the entire Rig itself**, so your entrypoint command can leverage the nix store path that will eventually point to your `RIG.md` file. If your harness supports
injecting prompts via the command line, you can define an entrypoint that wraps this harness with just the correct arguments, so that `rigup run` will launch that harness with the correct
context right away. And that is exactly what the builtin support for Claude Code does:

```nix
config.entrypoint =
    rig:
    let
      manifestPath = rig.manifest.override { shownDocRoot = "$RIG_DOCS"; };
    in
      pkgs.writeShellScriptBin "claude" ''
        exec ${pkgs.lib.getExe claude-code} \
        --append-system-prompt "$(cat ${manifestPath})" \
        "$@"
      '';

```

And you could feed configuration options to the harness while you're at it, which is what Rigup does to enable MCP servers on a variety of compatible harnesses, all from the same MCP server declaration.

Again we're in Nix territory here, so your entrypoint could be any program, from any of your flake inputs, and you can probably make any harness, present or future, work nicely with Rigup. But it
doesn't mean that you have to do any of this yourself:  Rigup ships with support for most of the major terminal-based AI harnesses: Claude Code, OpenCode, Pi, Copilot CLI and Cursor CLI out of the box.
You just need to configure your rig to use some of the ready-made riglets that Rigup provides. We'll dig into those in a minute.

## Rigs for every task

Riglets are the atoms. A **rig** is the molecule: a collection of riglets assembled for a specific project or workflow. Maybe you need different environments for your day job and for
your side projects, maybe you want specialized agentic coding environments for different tasks (coding on the back end, coding on the front end, doing some data science etc.), or maybe a single
agentic setup covers all your needs! In any case, you will need to define at least one rig.

You define rigs in a `rigup.toml` file (or directly in Nix if you need the extra power) and include riglets, that come from the local flake or from flake inputs:

```toml
[rigs.default.riglets]
# self here means these riglets are defined locally
self = ["haskell", "frontend-design"]
# these riglets come from the Rigup Github repository
rigup = ["jj-basics", "typst-reporter"]
# these come from the @YPares/agent-skills repository
agent-skills = ["working-with-jj", "searxng-search"]
```

That's it. `nix build` and you get a self-contained directory with all the tools, docs, and config your agent needs—plus an auto-generated `RIG.md` manifest that tells the agent exactly what's available and when to use it.

Rigs can also **extend** each other. In my own setup, I have a `base` rig with riglets I use everywhere (Haskell, Nix, frontend design, code review, etc.), and harness-specific rigs (`claude`, `pi`, `opencode`) that extend it with whatever extra glue each harness needs. I also use different riglets for work-related stuff and personal stuff.

## Useful riglets from day one

You don't have to start from scratch. There's already a small but practical ecosystem:

- **The `rigup.nix` repo itself** ships with example riglets: `jj-basics` (Jujutsu VCS), `typst-reporter` (document generation with Pandoc/Typst), `riglet-creator` (teaches your agent to write more riglets—yes, it's meta), and `nix-module-system` (covers the dark corners of Nix modules).

- **[@YPares' agent-skills](https://github.com/YPares/agent-skills)** is a separate flake of community-maintained riglets: `working-with-jj`, `searxng-search`, and others. These are also regular Claude Skills under the hood, so you can use them standalone too.

- **Anthropic's official skills** can be wrapped as riglets in a few lines of Nix. The [frontend-design riglet](https://raw.githubusercontent.com/YPares/rigup.nix/refs/heads/main/templates/default/riglets/frontend-design.nix) does exactly this—it pulls the skill source from Anthropic's repo and bundles it with `nodejs`. No reinvention, just repackaging.

- **MCP servers?** [One-liner riglets](https://github.com/YPares/rigup.nix/blob/main/riglets/mcp-cased-kit.nix). Since Nix provides `uv` (or any other runtime) directly from the store, you get a fully reproducible, zero-setup MCP server that your agent can spin up on demand.


**Nix flakes are the marketplace.** Riglets are just flake outputs: you pull them in as inputs, same as any other Nix dependency. There's no centralized registry
Someone maintains a GitHub repository with useful riglets? Add it to your inputs and you're done. Want to share your own? Anyone can point their flake at yours. 
Reproducibility comes for free because that's how Nix flakes work.

And if what you need doesn't exist yet—well, writing a riglet is rather straightforward. Your agent, armed with the `riglet-creator` riglet, can do most of the work for you.

---

Sounds interesting? Give [Rigup](https://github.com/YPares/rigup.nix) a try today with your favorite harness :) 

Until next time 👋

[^1]: You may be alarmed that I'm conflating *skills* and *rules* here, and I haven't even talked about Claude Code *agents* yet. The agentic coding community has a lot of different ways to
describe what, in the end, is just feeding tokens to your LLM. The nuances between these concepts and the exact extent of their overlap isn't really the point of this article, so forgive me
for simplifying some concepts here. If you decide to give Rigup a try after this article, you'll find that it offers some options as to how your instructions are injected in the LLM's context window (inject just
the "when to use" instructions, or inject the table of contents too, or inline the entire skill in the conversation) as well as some support for slash-commands found in some harnesses. So, while
skills, rules, agents, and prompt commands aren't strictly identical the overlap is large enough that Rigup can still act as the unifying layer.

