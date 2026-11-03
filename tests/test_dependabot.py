"""Checks for the Dependabot configuration. Requires PyYAML."""

from pathlib import Path
import unittest

import yaml


CONFIG = Path(__file__).resolve().parents[1] / ".github" / "dependabot.yml"

# Values from GitHub's Dependabot configuration options reference.
SUPPORTED_ECOSYSTEMS = frozenset(
    {
        "apm", "bazel", "bun", "bundler", "cargo", "composer", "conda",
        "deno", "devcontainers", "docker", "docker-compose", "dotnet-sdk",
        "elm", "github-actions", "gitsubmodule", "gomod", "gradle", "helm",
        "julia", "maven", "mix", "nix", "npm", "nuget", "opentofu", "pip",
        "pre-commit", "pub", "rust-toolchain", "sbt", "swift", "terraform",
        "uv", "vcpkg",
    }
)


class DependabotConfigTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.source = CONFIG.read_text(encoding="utf-8")
        cls.config = yaml.safe_load(cls.source)

    def updates(self):
        self.assertIsInstance(self.config, dict)
        updates = self.config.get("updates")
        self.assertIsInstance(updates, list)
        self.assertTrue(updates, "At least one update must be configured")
        for update in updates:
            self.assertIsInstance(update, dict)
        return updates

    def test_configuration_version(self):
        self.assertIsInstance(self.config, dict)
        version = self.config.get("version")
        self.assertIs(type(version), int)
        self.assertEqual(version, 2)

    def test_each_update_names_a_supported_ecosystem(self):
        for update in self.updates():
            with self.subTest(update=update):
                ecosystem = update.get("package-ecosystem")
                self.assertIsInstance(ecosystem, str)
                self.assertIn(ecosystem, SUPPORTED_ECOSYSTEMS)

    def test_root_update_is_scheduled_weekly(self):
        self.assertTrue(
            any(
                update.get("directory") == "/"
                and isinstance(update.get("schedule"), dict)
                and update["schedule"].get("interval") == "weekly"
                for update in self.updates()
            ),
            "Expected a weekly update for the repository root",
        )

    def test_yaml_has_no_duplicate_mapping_keys(self):
        def check_node(node):
            if isinstance(node, yaml.MappingNode):
                keys = set()
                for key, value in node.value:
                    self.assertIsInstance(key, yaml.ScalarNode)
                    self.assertNotIn(key.value, keys, f"Duplicate YAML key: {key.value}")
                    keys.add(key.value)
                    check_node(value)
            elif isinstance(node, yaml.SequenceNode):
                for value in node.value:
                    check_node(value)

        check_node(yaml.compose(self.source, Loader=yaml.SafeLoader))


if __name__ == "__main__":
    unittest.main()
