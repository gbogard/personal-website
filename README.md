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

Install the dependencies:

```bash
npm i
npm run playwright:install
```

Launch the Hugo server:

```bash
hugo serve
```

Then generate the PDF:

```bash
npm run generate-pdf
```

This will generate a PDF version of the resume and output it to the `public` directory.
