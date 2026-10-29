class RspackRunner < Formula
  desc "Run Vue CLI 5 applications with Rspack"
  homepage "https://github.com/PuTongjian/rspack-runner"
  version "0.1.0"
  head "https://github.com/PuTongjian/rspack-runner.git", branch: "main"

  depends_on "node" => :build

  def install
    system "node", "scripts/build-executable.cjs"
    bin.install "dist/rspack-runner"
  end

  test do
    assert_match "Usage: rspack-runner", shell_output("#{bin}/rspack-runner --help")
    (testpath/"probe.test.mjs").write <<~JS
      import { test, expect } from 'vitest';
      test('bundled Vitest', () => expect(1 + 1).toBe(2));
    JS
    system bin/"rspack-runner", "test", testpath
  end
end
