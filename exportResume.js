/**
 * Exports the résumé content of the Hugo site to a neutral, structured
 * intermediate file (resume.yaml).
 *
 * Source of truth stays the site content:
 *   content/resume/_index.md       -> "about" section
 *   content/resume/jobs/<job>/index.md or <job>.md -> jobs (front matter + body)
 *
 * The layout mirrors what the /resume/ page renders (layouts/resume/list.html
 * + layouts/partials/job-item.html):
 *   - date range, employer (and client, when present), tools
 *   - body = the summary, i.e. the content before the `<!--more-->` divider
 *     (company descriptions and other detail are website-only)
 *   - jobs sorted by startDate, most recent first
 *
 * `{{% include "path" %}}` shortcodes are resolved like Hugo does.
 *
 * Usage: node exportResume.js   (writes resume.yaml)
 * Then:  typst compile resume.typ assets/resume.pdf
 */
const fs = require("fs")
const path = require("path")
const matter = require("gray-matter")

const root = __dirname
const resumeDir = path.join(root, "content", "resume")
const jobsDir = path.join(resumeDir, "jobs")
const out = path.join(root, "resume.yaml")

const MONTHS = [
  "January", "February", "March", "April", "May", "June",
  "July", "August", "September", "October", "November", "December",
]

// "2025-04-16" | "2025-04" | Date -> "April 2025"
function formatDate(input) {
  if (!input) return null
  const d = input instanceof Date ? input : new Date(String(input).replace(/^(\d{4})-(\d{2})$/, "$1-$2-01"))
  if (Number.isNaN(d.getTime())) return null
  return `${MONTHS[d.getUTCMonth()]} ${d.getUTCFullYear()}`
}

// Date | "2025-04-16" -> ISO string, used for chronological sorting.
function toIso(input) {
  if (!input) return null
  const d = input instanceof Date ? input : new Date(String(input))
  return Number.isNaN(d.getTime()) ? null : d.toISOString()
}

// Tidy raw markdown/HTML for consumption by Typst's md():
// drop HTML tags, turn <br> into line breaks, collapse blank lines.
function cleanMarkdown(raw) {
  return raw
    .replace(/\{\{<[\s\S]*?>\}\}/g, "") // drop inline shortcodes (e.g. {{<small-image>}}, {{<resume-pdf>}})
    .replace(/<h[1-6][^>]*>.*?<\/h[1-6]>/gis, "") // drop headings (e.g. the "About me" title)
    .replace(/<\/?br\s*\/?>/gi, "\n")
    .replace(/<img[^>]*>/gi, "")
    .replace(/<[^>]+>/g, "")
    .replace(/\n{3,}/g, "\n\n")
    .trim()
}

function resolveIncludes(file, content) {
  return content.replace(/{{%\s*include\s+"([^"]+)"\s*%}}/g, (_, href) => {
    const inc = path.resolve(path.dirname(file), href)
    return fs.readFileSync(inc, "utf8")
  })
}

// Content before the `<!--more-->` divider: the job summary exported to the PDF.
function summaryOnly(md) {
  const marker = "<!--more-->"
  const i = md.indexOf(marker)
  return i === -1 ? md : md.slice(0, i)
}

// Render simple markdown as Typst-agnostic text suitable for cmarker:
// headings become bold paragraphs (keeps the résumé minimal).
function markdownBody(md) {
  return cleanMarkdown(md.replace(/^#{1,6}\s+(.+)$/gm, "**$1**"))
}

function parseJob(file) {
  const raw = fs.readFileSync(file, "utf8")
  const { data, content } = matter(resolveIncludes(file, raw))

  // Only the summary (content before the `<!--more-->` divider) is exported to
  // the PDF; company descriptions and other detail stay on the website.
  const bodyText = markdownBody(summaryOnly(content))

  return {
    title: String(data.title || path.basename(path.dirname(file))),
    _start: toIso(data.startDate), // internal, for sorting only
    startDate: formatDate(data.startDate),
    endDate: formatDate(data.endDate),
    employer: data.employer && data.employer.name ? String(data.employer.name) : null,
    employerLink: data.employer && data.employer.link ? String(data.employer.link) : null,
    client: data.client && data.client.name ? String(data.client.name) : null,
    clientLink: data.client && data.client.link ? String(data.client.link) : null,
    tools: Array.isArray(data.tools) ? data.tools.map(String) : [],
    body: bodyText || "—",
  }
}

function emitYaml(data) {
  const lines = []
  lines.push(`author: ${JSON.stringify(data.author)}`)
  lines.push("about: |")
  for (const l of data.about.split("\n")) lines.push(`  ${l}`)
  lines.push("skills: |")
  for (const l of data.skills.split("\n")) lines.push(`  ${l}`)
  lines.push("education: |")
  for (const l of data.education.split("\n")) lines.push(`  ${l}`)
  lines.push("jobs:")
  for (const j of data.jobs) {
    lines.push(`  - title: ${JSON.stringify(j.title)}`)
    if (j.employer) lines.push(`    employer: ${JSON.stringify(j.employer)}`)
    if (j.employerLink) lines.push(`    employerLink: ${JSON.stringify(j.employerLink)}`)
    if (j.client) lines.push(`    client: ${JSON.stringify(j.client)}`)
    if (j.clientLink) lines.push(`    clientLink: ${JSON.stringify(j.clientLink)}`)
    lines.push(`    start: ${JSON.stringify(j.startDate)}`)
    lines.push(`    end: ${JSON.stringify(j.endDate)}`)
    if (j.tools.length > 0) {
      lines.push(`    tools: [${j.tools.map((t) => JSON.stringify(t)).join(", ")}]`)
    }
    lines.push("    body: |")
    for (const l of j.body.split("\n")) lines.push(`      ${l}`)
  }
  return `${lines.join("\n")}\n`
}

function main() {
  const author = (() => {
    const cfg = fs.readFileSync(path.join(root, "config.toml"), "utf8")
    const m = cfg.match(/title\s*=\s*['"]([^'"]+)['"]/)
    return m ? m[1] : "Guillaume Bogard"
  })()

  const about = cleanMarkdown(
    matter(fs.readFileSync(path.join(resumeDir, "_index.md"), "utf8")).content
  )

  const skills = cleanMarkdown(
    fs.readFileSync(path.join(root, "layouts", "partials", "skills.md"), "utf8")
  )

  const education = cleanMarkdown(
    fs.readFileSync(path.join(root, "layouts", "partials", "education.md"), "utf8")
  )

  const jobs = fs
    .readdirSync(jobsDir, { withFileTypes: true })
    .flatMap((entry) => {
      if (entry.isDirectory()) {
        const idx = path.join(jobsDir, entry.name, "index.md")
        return fs.existsSync(idx) ? [parseJob(idx)] : []
      }
      if (entry.isFile() && entry.name.endsWith(".md")) {
        return [parseJob(path.join(jobsDir, entry.name))]
      }
      return []
    })
    .sort((a, b) => new Date(b._start) - new Date(a._start))
    .map(({ _start, ...job }) => job)

  fs.writeFileSync(out, emitYaml({ author, about, skills, education, jobs }))
  console.log(`Wrote ${out} (${jobs.length} jobs)`)
}

main()