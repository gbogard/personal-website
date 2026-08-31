# Personal website

## Cloning the repository and its submodules

```bash
git clone git@github.com:gbogard/personal-website.git
cd personal-website
git submodule update --init --recursive
```

## Entering the development environment

This website is built with Hugo. There is a nix flake that can provide a development shell which includes Hugo. 

```bash
nix develop
```

This will enter a shell with the development environment.

This shell is entered automatically when using `direnv`.

## Building the website

```bash
hugo
```

This will build the website and output it to the `public` directory.

## Generating a PDF version of the resume

The PDF résumé is rendered from the live `/resume/` section of the site (`content/resume/`),
so the PDF can never drift from the website. Two stages keep that promise:

1. `npm run export-resume` — reads the Hugo content (`content/resume/`), resolves the
   `{{% include %}}` shortcodes, and writes a neutral `resume.yaml` (gitignored).
2. `npm run resume-pdf`   — compiles `resume.typ` (the layout template) with **Typst**,
   using that data, into `assets/resume.pdf`.

`npm run generate-pdf` does both. Everything needed (Node, Typst, fonts) is provided
by the nix dev shell:

```bash
nix develop          # or let direnv handle it
npm install          # once
npm run generate-pdf # renders assets/resume.pdf
```
