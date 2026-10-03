import { dirname, relative, resolve } from "node:path";

const source = resolve(process.argv[2] ?? import.meta.dir);
const adapters = ["storage", "provider", "callback"];
const ownerOf = (path: string) => {
	const [first, name] = relative(source, path).split("/");
	return first === "capabilities" && name
		? `capabilities/${name}`
		: (first ?? "");
};
const application = (owner: string) =>
	owner === "auth" || owner.startsWith("capabilities/");
const moduleOwner = (owner: string) =>
	application(owner) || adapters.includes(owner);
const graph = new Map<string, Set<string>>();
const roots = process.argv[2]
	? [source]
	: [source, resolve(source, "../tests"), resolve(source, "../examples")];
for (const root of roots) {
	for await (const file of new Bun.Glob("**/*.ts").scan({
		cwd: root,
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
				if (application(owner) && specifier !== "effect")
					throw new Error("Application cannot import infrastructure");
				continue;
			}
			const path = resolve(dirname(file), specifier).replace(/\.ts$/, "");
			const target = ownerOf(path);
			if (
				moduleOwner(target) &&
				target !== owner &&
				path !== resolve(source, target) &&
				path !== resolve(source, target, "index")
			)
				throw new Error(`Private module import: ${relative(source, file)}`);
			if (!moduleOwner(owner)) continue;
			if (
				target === owner ||
				(target === "shared" &&
					(owner === "capabilities/authentication" ||
						!owner.startsWith("capabilities/")))
			)
				continue;
			if (
				(application(owner) &&
					!(owner === "auth" && target === "capabilities/authentication")) ||
				!application(target)
			)
				throw new Error(
					`Dependency must point inward: ${relative(source, file)} -> ${specifier}`,
				);
			const edges = graph.get(owner) ?? new Set<string>();
			edges.add(target);
			graph.set(owner, edges);
		}
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
