{
  description = "Portfolio development environment";

  inputs = {
    nixpkgs.url = "github:NixOS/nixpkgs/24.05";
    flake-utils.url = "github:numtide/flake-utils";
  };

  outputs = { self, nixpkgs, flake-utils }:
    flake-utils.lib.eachDefaultSystem (system:
      let
        pkgs = import nixpkgs { inherit system; };
      in
      {
        devShells.default = pkgs.mkShell {
          name = "portfolio-shell";
          buildInputs = with pkgs; [ 
            hugo
            nodejs_22
            (nodePackages.yarn.override {
              nodejs = nodejs_22;
            })
          ];
        };
      });
}
