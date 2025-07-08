const { execSync } = require("child_process");

function commandExists(cmd) {
    try {
        execSync(`${cmd} --version`, { stdio: "ignore" });
        return true;
    } catch {
        return false;
    }
}

try {
    if (!commandExists("pnpm")) {
        console.log("Installing pnpm...");
        execSync("npm install -g pnpm@latest-10", { stdio: "inherit" });
    } else {
        const version = execSync("pnpm --version").toString().trim();
        console.log(`pnpm already installed. Version: ${version}`);
    }

    console.log("Running pnpm build...");
    execSync("pnpm build", { stdio: "inherit" });

    console.log("Running pnpm inject...");
    execSync("pnpm inject", { stdio: "inherit" });

    console.log("All done!");
} catch (err) {
    console.error("Error occurred:", err.message);
    process.exit(1);
}
