import java.util.Arrays;
import java.util.List;

import com.android.build.api.dsl.ApplicationExtension;
import com.android.build.api.dsl.ApplicationProductFlavor;
import org.gradle.api.DefaultTask;
import org.gradle.api.Plugin;
import org.gradle.api.Project;
import org.gradle.api.Task;

public class RustPlugin implements Plugin<Project> {
    public static final String TASK_GROUP = "rust";

    public abstract static class Config {
        private String rootDirRel;

        public String getRootDirRel() {
            return rootDirRel;
        }

        public void setRootDirRel(String rootDirRel) {
            this.rootDirRel = rootDirRel;
        }
    }

    @Override
    public void apply(Project project) {
        Config config = project.getExtensions().create("rust", Config.class);

        List<String> defaultAbiList = Arrays.asList("arm64-v8a", "armeabi-v7a", "x86", "x86_64");
        List<String> abiList = splitOrDefault(project.findProperty("abiList"), defaultAbiList);

        List<String> defaultArchList = Arrays.asList("arm64", "arm", "x86", "x86_64");
        List<String> archList = splitOrDefault(project.findProperty("archList"), defaultArchList);

        List<String> defaultTargetList = Arrays.asList("aarch64", "armv7", "i686", "x86_64");
        List<String> targetsList = splitOrDefault(project.findProperty("targetList"), defaultTargetList);

        project.getExtensions().configure(ApplicationExtension.class, extension -> {
            extension.getFlavorDimensions().add("abi");

            extension.getProductFlavors().create("universal", flavor ->
                configureFlavor(flavor, abiList)
            );

            for (int index = 0; index < defaultArchList.size(); index += 1) {
                String arch = defaultArchList.get(index);
                String abi = defaultAbiList.get(index);

                extension.getProductFlavors().create(arch, flavor ->
                    configureFlavor(flavor, List.of(abi))
                );
            }
        });

        project.afterEvaluate(ignored -> {
            for (String profile : Arrays.asList("debug", "release")) {
                String profileCapitalized = capitalize(profile);
                Task buildTask = project.getTasks().maybeCreate(
                    "rustBuildUniversal" + profileCapitalized,
                    DefaultTask.class
                );

                buildTask.setGroup(TASK_GROUP);
                buildTask.setDescription("Build dynamic library in " + profile + " mode for all targets");
                project.getTasks()
                    .getByName("mergeUniversal" + profileCapitalized + "JniLibFolders")
                    .dependsOn(buildTask);

                for (int index = 0; index < targetsList.size(); index += 1) {
                    String targetName = targetsList.get(index);
                    String targetArch = archList.get(index);
                    String targetArchCapitalized = capitalize(targetArch);
                    BuildTask targetBuildTask = project.getTasks().maybeCreate(
                        "rustBuild" + targetArchCapitalized + profileCapitalized,
                        BuildTask.class
                    );

                    targetBuildTask.setGroup(TASK_GROUP);
                    targetBuildTask.setDescription(
                        "Build dynamic library in " + profile + " mode for " + targetArch
                    );
                    targetBuildTask.setRootDirRel(config.getRootDirRel());
                    targetBuildTask.setTarget(targetName);
                    targetBuildTask.setRelease("release".equals(profile));

                    buildTask.dependsOn(targetBuildTask);
                    project.getTasks()
                        .getByName("merge" + targetArchCapitalized + profileCapitalized + "JniLibFolders")
                        .dependsOn(targetBuildTask);
                }
            }
        });
    }

    private static void configureFlavor(ApplicationProductFlavor flavor, List<String> abiFilters) {
        setDimension(flavor, "abi");
        flavor.getNdk().getAbiFilters().addAll(abiFilters);
    }

    private static void setDimension(ApplicationProductFlavor flavor, String dimension) {
        try {
            flavor.getClass().getMethod("setDimension", String.class).invoke(flavor, dimension);
        } catch (ReflectiveOperationException error) {
            throw new RuntimeException("Failed to configure flavor dimension", error);
        }
    }

    private static List<String> splitOrDefault(Object property, List<String> defaultValue) {
        if (!(property instanceof String text) || text.isBlank()) {
            return defaultValue;
        }

        return Arrays.stream(text.split(","))
            .map(String::trim)
            .filter(item -> !item.isEmpty())
            .toList();
    }

    private static String capitalize(String value) {
        if (value == null || value.isEmpty()) {
            return value;
        }

        return Character.toUpperCase(value.charAt(0)) + value.substring(1);
    }
}
