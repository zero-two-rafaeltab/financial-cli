import { dirname, relative, resolve } from "node:path";

const source = resolve(process.argv[2] ?? import.meta.dir);
const modules = ["auth", "storage", "provider", "callback"];
const ownerOf = (path: string) => {
	const parts = relative(source, path).split("/");
	return parts[0] === "capabilities"
		? `capabilities/${parts[1] ?? ""}`
		: (parts[0] ?? "");
};
const isCapability = (owner: string) =>
	owner === "auth" || owner.startsWith("capabilities/");
const graph = new Map<string, Set<string>>();
for await (const file of new Bun.Glob("**/*.ts").scan({
	cwd: source,
	absolute: true,
})) {
	const owner = ownerOf(file);
	const text = await Bun.file(file).text();
	const imports = Array.from(
		text.matchAll(/(?:from\s+|import\s*\(?\s*)(["'])([^"']+)\1/g),
		(match) => match[2] ?? "",
	);
	for (const specifier of imports) {
		if (!specifier.startsWith(".")) {
			if (isCapability(owner) && specifier !== "effect")
				throw new Error("Application cannot import infrastructure");
			continue;
		}
		const path = resolve(dirname(file), specifier).replace(/\.ts$/, "");
		const target = ownerOf(path);
		if (target === owner || target === "shared") continue;
		if (
			(isCapability(owner) && !isCapability(target)) ||
			(modules.includes(owner) && !isCapability(owner) && !isCapability(target))
		)
			throw new Error(
				`Dependency must point inward: ${relative(source, file)} -> ${specifier}`,
			);
		if (
			(modules.includes(target) || isCapability(target)) &&
			path !== resolve(source, target) &&
			path !== resolve(source, target, "index")
		)
			throw new Error(`Private module import: ${relative(source, file)}`);
		const edges = graph.get(owner) ?? new Set<string>();
		edges.add(target);
		graph.set(owner, edges);
	}
}
for (const module of graph.keys()) {
	const visit = (node: string, seen: Set<string>) => {
		if (seen.has(node)) throw new Error("Module dependency cycle");
		const next = new Set(seen);
		next.add(node);
		for (const edge of graph.get(node) ?? []) visit(edge, next);
	};
	visit(module, new Set());
}
console.log(
	"Architecture: public module imports, inward dependency graph and acyclicity verified.",
);
