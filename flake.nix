{
  description = "Personal website development environment";

  inputs = {
    nixpkgs.url = "github:NixOS/nixpkgs/nixpkgs-unstable";
    flake-utils.url = "github:numtide/flake-utils";
  };

  outputs = { self, nixpkgs, flake-utils }:
    flake-utils.lib.eachDefaultSystem (system:
      let pkgs = import nixpkgs { inherit system; };
      in {
        devShells.default = pkgs.mkShell {
          name = "portfolio-shell";
          buildInputs = with pkgs; [
            hugo
            nodejs_24
            go
            git
            # hugo needs git on PATH to resolve the theme module from
            # github.com/panr/hugo-theme-terminal/v4 (hugo runs `go mod download`).
            typst
            # compiles resume.typ -> assets/resume.pdf from content/resume/
            noto-fonts
            noto-fonts-color-emoji
          ];
          env = {
            # Typst scans these directories recursively for fonts, instead of
            # relying on the host system's fonts, so the PDF looks the same in
            # any environment.
            TYPST_FONT_PATHS = "${pkgs.noto-fonts}/share/fonts:${pkgs.noto-fonts-color-emoji}/share/fonts";
          };
        };
      });
}
