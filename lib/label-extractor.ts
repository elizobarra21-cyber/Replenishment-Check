export type LabelExtractionResult = {
	article: string | null;
	confidence: "high" | "medium" | "low";
	candidates: string[];
	normalizedText: string;
	matchedLine: string | null;
	parsed: {
		rawLine: string;
		article: string;
		color: string;
		ignoredDigits: string;
		season: string;
		storageSection: string;
	} | null;
};

export type LabelExtractionOptions = {
	hintText?: string;
	preferredDigits?: number;
};

function normalizeText(raw: string): string {
	return raw
		.replace(/[|]/g, "1")
		.replace(/[OoОо]/g, "0")
		.replace(/[^\S\r\n]+/g, " ")
		.trim();
}

function collectNumericCandidates(text: string): string[] {
	const candidates: string[] = [];
	const seen = new Set<string>();

	function addCandidate(value: string) {
		if (/^\d{17}$/.test(value) && !seen.has(value)) {
			seen.add(value);
			candidates.push(value);
		}
	}

	function collectFromScope(scope: string) {
		const compactScope = scope.replace(/\D/g, "");
		addCandidate(compactScope);

		const exactPattern = /(?:^|\D)(\d{17})(?=\D|$)/g;
		let match: RegExpExecArray | null;
		while ((match = exactPattern.exec(scope)) !== null) {
			addCandidate(match[1]);
		}

		const groups = scope.match(/\d+/g) ?? [];
		for (let start = 0; start < groups.length; start += 1) {
			let compactGroups = "";
			for (let end = start; end < groups.length; end += 1) {
				compactGroups += groups[end];
				if (compactGroups.length === 17) {
					addCandidate(compactGroups);
					break;
				}
				if (compactGroups.length > 17) {
					break;
				}
			}
		}
	}

	for (const line of text.split(/\r?\n/)) {
		collectFromScope(line);
	}
	collectFromScope(text);

	return candidates;
}

function collectArticleCandidates(text: string): string[] {
	const candidates: string[] = [];
	const seen = new Set<string>();

	function addCandidate(value: string) {
		if (/^\d{7}$/.test(value) && !seen.has(value)) {
			seen.add(value);
			candidates.push(value);
		}
	}

	for (const line of text.split(/\r?\n/)) {
		const groups = line.match(/\d+/g) ?? [];
		for (const group of groups) {
			if (group.length >= 7) {
				addCandidate(group.slice(0, 7));
			}
		}
	}

	return candidates;
}

function parseStructuredCodeLine(text: string): {
	rawLine: string;
	article: string;
	color: string;
	ignoredDigits: string;
	season: string;
	storageSection: string;
} | null {
	const lines = text
		.split(/\r?\n/)
		.map((line) => line.trim())
		.filter(Boolean);

	for (const line of lines) {
		for (const code of collectNumericCandidates(line)) {
			return {
				rawLine: code,
				article: code.slice(0, 7),
				color: code.slice(7, 10),
				ignoredDigits: code.slice(10, 12),
				season: code.slice(12, 13),
				storageSection: code.slice(13, 17),
			};
		}
	}

	for (const code of collectNumericCandidates(text)) {
		return {
			rawLine: code,
			article: code.slice(0, 7),
			color: code.slice(7, 10),
			ignoredDigits: code.slice(10, 12),
			season: code.slice(12, 13),
			storageSection: code.slice(13, 17),
		};
	}

	return null;
}

function formatParsedCodeLine(code: {
	article: string;
	color: string;
	ignoredDigits: string;
	season: string;
	storageSection: string;
}) {
	return [
		code.article,
		code.color,
		code.ignoredDigits,
		code.season,
		code.storageSection,
	]
		.filter(Boolean)
		.join(" ");
}

export function extractArticleFromLabel(
	rawText: string,
	options: LabelExtractionOptions = {},
): LabelExtractionResult {
	const normalizedText = normalizeText(rawText);
	const parsedLine = parseStructuredCodeLine(normalizedText);
	const candidates = collectNumericCandidates(normalizedText);
	const articleCandidates = collectArticleCandidates(normalizedText);

	if (parsedLine) {
		return {
			article: parsedLine.article,
			confidence: "high",
			candidates,
			normalizedText,
			matchedLine: formatParsedCodeLine(parsedLine),
			parsed: {
				...parsedLine,
				rawLine: formatParsedCodeLine(parsedLine),
			},
		};
	}

	return {
		article: articleCandidates[0] ?? null,
		confidence: "low",
		candidates: candidates.length ? candidates : articleCandidates,
		normalizedText,
		matchedLine: null,
		parsed: null,
	};
}
