class RspackRunner < Formula
  desc "Run Vue CLI 5 applications with Rspack"
  homepage "https://github.com/PuTongjian/rspack-runner"
  version "0.1.0"
  head "https://github.com/PuTongjian/rspack-runner.git", branch: "main"

  depends_on "node@20"

  def install
    if ENV["RSPACK_RUNNER_SOURCE"]
      source = ENV["RSPACK_RUNNER_SOURCE"]
      %w[package.json package-lock.json README.md src scripts].each do |entry|
        cp_r "#{source}/#{entry}", entry
      end
    end
    system "npm", "ci", "--omit=dev"
    chmod 0755, "src/cli.cjs"
    libexec.install Dir["*"]
    bin.install_symlink libexec/"src/cli.cjs" => "rspack-runner"
  end

  test do
    assert_match "Usage: rspack-runner", shell_output("#{bin}/rspack-runner --help")
  end
end
