# Purpose of this doc
Prompts I used in my claude code session

---

I apply to many positions which forces me to constantly tailor my resume (based off of Jake's resume)

Some position's descriptions compels me to do the following to my sections (e.g. Experience), sub-sections (e.g. a job) and bullet points: re-order, omit, add, and delete.

This can be tedious and time consuming, especially when applying for different kinds of roles e.g. backend and embedded system software engineering. I've created resume variants just to skip the time it takes to tailor a resume for that specific role, but I still need to tailor it to the job posting itself

Making these edits to my Latex resume on VSCode isn't straight forward and is time consuming.

I'd rather have a local web app to do this visually, and export it as a PDF and text file. The data model for a resume should be stable, so that when I feed claude the model and the resume artifact (instead of the PDF or text file), I can have Claude.ai tailor it for me. Once done, I'll import the modified resume artifact to the web app and have it convert to PDF or text file.                
                                 
Before coding, ask me questions to clear all ambiguities.

---

My Feedback and Questions:
- Describe to me the E2E flow
- The editor should have an option to delete and insert
- Will the printed output be ATS friendly (do you understand what that means?)
- Are Section.items and Item.bullets rendered in order?
- Is everything based off of the JSON, thus making it portable if I decide to migrate to a different web app?

---