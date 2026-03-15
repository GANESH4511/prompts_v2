/**
 * contextBuilder.js
 *
 * Builds structured PAGE CONTEXT blocks injected into the implement pipeline.
 *
 * mode: 'nlp'       — emits INTENT per section (for Pass 1 / planning)
 * mode: 'developer' — emits RULES per section (for Pass 2 / code gen)
 *
 * Returns an empty string if the page has no sections, so caller behaviour
 * degrades gracefully to the existing pre-context prompt shape.
 */

/**
 * @param {object} page           - Prisma Page with sections[] + prompts[]
 * @param {'nlp'|'developer'} mode
 * @param {string[]} [filterSections] - Optional: only include these section names
 * @returns {string}
 */
function buildPageContext(page, mode, filterSections) {
    if (!page || !page.sections || page.sections.length === 0) return '';

    const promptType = mode === 'nlp' ? 'NLP' : 'DEVELOPER';
    const fieldLabel = mode === 'nlp' ? 'INTENT' : 'RULES';

    let sections = page.sections;
    if (filterSections && filterSections.length > 0) {
        const filterSet = new Set(filterSections.map(s => s.toLowerCase()));
        sections = sections.filter(s => filterSet.has(s.name.toLowerCase()));
    }

    const sectionBlocks = sections
        .map(section => {
            const matchingPrompts = (section.prompts || [])
                .filter(p => p.promptType === promptType)
                .map(p => p.template.trim())
                .filter(Boolean);

            // For NLP mode, fall back to section.purpose if no NLP prompts seeded
            const content = matchingPrompts.length > 0
                ? matchingPrompts.join('\n         ')
                : (mode === 'nlp' ? section.purpose : null);

            if (!content) return null;

            return `SECTION: "${section.name}" (lines ${section.startLine}–${section.endLine})
  ${fieldLabel}: ${content}`;
        })
        .filter(Boolean);

    if (sectionBlocks.length === 0) return '';

    const header = [
        `=== PAGE CONTEXT ===`,
        `Component: ${page.componentName}`,
        `Purpose:   ${page.purpose}`,
    ].join('\n');

    return `${header}\n\n=== SECTIONS ===\n\n${sectionBlocks.join('\n\n')}`;
}

module.exports = { buildPageContext };
