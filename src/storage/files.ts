import { randomUUID } from "node:crypto";
import {
	closeSync,
	constants,
	existsSync,
	fstatSync,
	fsyncSync,
	lstatSync,
	mkdirSync,
	openSync,
	readFileSync,
	renameSync,
	rmSync,
	writeFileSync,
} from "node:fs";
import { dirname, isAbsolute, join, relative, resolve, sep } from "node:path";

// Internal storage adapter mechanics shared by credential and transaction stores.
export function privateFiles(checkout: string, maxBytes: number) {
	const within = (path: string, parent: string) => {
		const rel = relative(parent, path);
		return (
			rel === "" ||
			(!rel.startsWith(`..${sep}`) && rel !== ".." && !isAbsolute(rel))
		);
	};
	const directory = (path: string) => {
		if (!isAbsolute(path) || within(resolve(path), resolve(checkout)))
			throw new Error("Unsafe directory");
		const chain: string[] = [];
		let current = path;
		while (current !== dirname(current)) {
			chain.unshift(current);
			current = dirname(current);
		}
		for (const entry of chain) {
			if (existsSync(entry)) {
				const st = lstatSync(entry);
				const safeOsTemp =
					["/tmp", "/var/tmp"].includes(entry) &&
					st.uid === 0 &&
					(st.mode & 0o1000) !== 0;
				if (
					st.isSymbolicLink() ||
					!st.isDirectory() ||
					(st.uid !== 0 && st.uid !== process.getuid?.()) ||
					((st.mode & 0o022) !== 0 && !safeOsTemp)
				)
					throw new Error("Unsafe directory");
			} else mkdirSync(entry, { mode: 0o700 });
			if (existsSync(join(entry, ".git")))
				throw new Error("Checkout directory");
		}
		const st = lstatSync(path);
		if ((st.mode & 0o077) !== 0 || st.uid !== process.getuid?.())
			throw new Error("Unsafe permissions");
	};
	const read = (
		dir: string,
		name: string,
		optional = false,
	): string | undefined => {
		directory(dir);
		const path = join(dir, name);
		if (!existsSync(path) && !lstatExists(path)) {
			if (optional) return undefined;
			throw new Error("Missing file");
		}
		const fd = openSync(path, constants.O_RDONLY | constants.O_NOFOLLOW);
		try {
			const st = fstatSync(fd);
			if (
				!st.isFile() ||
				st.nlink !== 1 ||
				st.uid !== process.getuid?.() ||
				(st.mode & 0o077) !== 0 ||
				st.size > maxBytes
			)
				throw new Error("Unsafe file");
			return readFileSync(fd, "utf8");
		} finally {
			closeSync(fd);
		}
	};
	const write = (
		dir: string,
		name: string,
		value: string,
		deadline = Infinity,
	) => {
		directory(dir);
		const target = join(dir, name);
		if (lstatExists(target)) {
			const st = lstatSync(target);
			if (
				!st.isFile() ||
				st.isSymbolicLink() ||
				st.nlink !== 1 ||
				st.uid !== process.getuid?.() ||
				(st.mode & 0o077) !== 0
			)
				throw new Error("Unsafe target");
		}
		const temp = join(dir, `.${name}.${randomUUID()}`);
		const fd = openSync(
			temp,
			constants.O_WRONLY |
				constants.O_CREAT |
				constants.O_EXCL |
				constants.O_NOFOLLOW,
			0o600,
		);
		let published = false;
		try {
			try {
				writeFileSync(fd, value);
				fsyncSync(fd);
			} finally {
				closeSync(fd);
			}
			if (performance.now() >= deadline)
				throw new Error("Attempt deadline elapsed");
			renameSync(temp, target);
			published = true;
			// Rename is the publication point. No post-publication operation can report
			// failure after replacing the previous credential. Crash durability is not claimed.
		} finally {
			if (!published) rmSync(temp, { force: true });
		}
	};

	return { directory, read, write };
}

export function lstatExists(path: string): boolean {
	try {
		lstatSync(path);
		return true;
	} catch (error) {
		if (error instanceof Error && "code" in error && error.code === "ENOENT")
			return false;
		throw error;
	}
}
