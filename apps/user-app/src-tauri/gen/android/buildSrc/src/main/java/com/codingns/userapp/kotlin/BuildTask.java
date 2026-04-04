import java.io.File;
import java.util.Arrays;
import java.util.List;
import java.util.Locale;

import org.gradle.api.DefaultTask;
import org.gradle.api.GradleException;
import org.gradle.api.logging.LogLevel;
import org.gradle.api.tasks.Input;
import org.gradle.api.tasks.TaskAction;

public class BuildTask extends DefaultTask {
    private String rootDirRel;
    private String target;
    private Boolean release;

    @Input
    public String getRootDirRel() {
        return rootDirRel;
    }

    public void setRootDirRel(String rootDirRel) {
        this.rootDirRel = rootDirRel;
    }

    @Input
    public String getTarget() {
        return target;
    }

    public void setTarget(String target) {
        this.target = target;
    }

    @Input
    public Boolean getRelease() {
        return release;
    }

    public void setRelease(Boolean release) {
        this.release = release;
    }

    @TaskAction
    public void assemble() {
        String executable = "pnpm";

        try {
            runTauriCli(executable);
        } catch (Exception error) {
            if (!isWindows()) {
                throw error;
            }

            List<String> fallbacks = Arrays.asList(
                executable + ".exe",
                executable + ".cmd",
                executable + ".bat"
            );

            Exception lastError = error;

            for (String fallback : fallbacks) {
                try {
                    runTauriCli(fallback);
                    return;
                } catch (Exception fallbackError) {
                    lastError = fallbackError;
                }
            }

            throw new RuntimeException(lastError);
        }
    }

    private void runTauriCli(String executable) {
        String resolvedRootDirRel =
            rootDirRel != null ? rootDirRel : fail("rootDirRel cannot be null");
        String resolvedTarget =
            target != null ? target : fail("target cannot be null");
        boolean resolvedRelease =
            release != null ? release : fail("release cannot be null");

        getProject().exec(spec -> {
            spec.workingDir(new File(getProject().getProjectDir(), resolvedRootDirRel));
            spec.setExecutable(executable);
            spec.args("tauri", "android", "android-studio-script");

            if (getProject().getLogger().isEnabled(LogLevel.DEBUG)) {
                spec.args("-vv");
            } else if (getProject().getLogger().isEnabled(LogLevel.INFO)) {
                spec.args("-v");
            }

            if (resolvedRelease) {
                spec.args("--release");
            }

            spec.args("--target", resolvedTarget);
        }).assertNormalExitValue();
    }

    private boolean isWindows() {
        return System.getProperty("os.name", "")
            .toLowerCase(Locale.ROOT)
            .contains("win");
    }

    private <T> T fail(String message) {
        throw new GradleException(message);
    }
}
