import { tmpdir } from "node:os";
import { basename, isAbsolute, relative, resolve } from "node:path";

function isInside(parent, candidate) {
  const pathFromParent = relative(parent, candidate);
  return Boolean(
    pathFromParent &&
      !pathFromParent.startsWith("..") &&
      !isAbsolute(pathFromParent),
  );
}

export function resolveBuildOutput(root, requestedOutput) {
  const defaultOutput = resolve(root, "dist");
  if (!requestedOutput) return defaultOutput;

  const output = resolve(root, requestedOutput);
  const temporaryRoots = new Set([resolve(tmpdir())]);
  if (process.platform === "darwin") temporaryRoots.add(resolve("/private/tmp"));

  const isNamedTemporaryOutput =
    basename(output).startsWith("photon-bench-") &&
    [...temporaryRoots].some((temporaryRoot) => isInside(temporaryRoot, output));

  if (output !== defaultOutput && !isNamedTemporaryOutput) {
    throw new Error(
      "Unsafe BUILD_DIR. Use the project dist directory or a photon-bench-* directory under the operating-system temp directory.",
    );
  }

  return output;
}
