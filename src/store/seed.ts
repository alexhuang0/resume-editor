import type { Resume } from "./schema";
import { newId } from "./schema";

export function makeSeedResume(name = "Default"): Resume {
  return {
    schemaVersion: 3,
    id: newId("r"),
    name,
    updatedAt: new Date().toISOString(),
    font: "latin-modern",
    header: {
      fullName: "Jake Ryan",
      fields: [
        { id: newId("hf"), label: "123 Street Name, Town, State 12345" },
        { id: newId("hf"), label: "123-456-7890" },
        { id: newId("hf"), label: "jake@su.edu", url: "mailto:jake@su.edu" },
        { id: newId("hf"), label: "linkedin.com/in/jake", url: "https://linkedin.com/in/jake" },
        { id: newId("hf"), label: "github.com/jake", url: "https://github.com/jake" },
      ],
    },
    sections: [
      {
        id: newId("s"),
        kind: "education",
        title: "Education",
        items: [
          {
            id: newId("i"),
            heading: "Southwestern University",
            subheading: "Bachelor of Arts in Computer Science, Minor in Business",
            location: "Georgetown, TX",
            dateRange: "Aug. 2018 -- May 2021",
            bullets: [],
          },
          {
            id: newId("i"),
            heading: "Blinn College",
            subheading: "Associate's in Liberal Arts",
            location: "Bryan, TX",
            dateRange: "Aug. 2014 -- May 2018",
            bullets: [],
          },
        ],
      },
      {
        id: newId("s"),
        kind: "experience",
        title: "Experience",
        items: [
          {
            id: newId("i"),
            heading: "Undergraduate Research Assistant",
            subheading: "Texas A&M University",
            location: "College Station, TX",
            dateRange: "June 2020 -- Present",
            bullets: [
              {
                id: newId("b"),
                text: "Developed a REST API using FastAPI and PostgreSQL to store data from learning management systems",
              },
              {
                id: newId("b"),
                text: "Developed a full-stack web application using Flask, React, PostgreSQL and Docker to analyze GitHub data",
              },
              {
                id: newId("b"),
                text: "Explored ways to visualize GitHub collaboration in a classroom setting",
              },
            ],
          },
          {
            id: newId("i"),
            heading: "Information Technology Support Specialist",
            subheading: "Southwestern University",
            location: "Georgetown, TX",
            dateRange: "Sep. 2018 -- Present",
            bullets: [
              {
                id: newId("b"),
                text: "Communicate with managers to set up campus computers used on campus",
              },
              {
                id: newId("b"),
                text: "Assess and troubleshoot computer problems brought by students, faculty and staff",
              },
              {
                id: newId("b"),
                text: "Maintain upkeep of computers, classroom equipment, and 200 printers across campus",
              },
            ],
          },
          {
            id: newId("i"),
            heading: "Artificial Intelligence Research Assistant",
            subheading: "Southwestern University",
            location: "Georgetown, TX",
            dateRange: "May 2019 -- July 2019",
            bullets: [
              {
                id: newId("b"),
                text: "Explored methods to generate video game dungeons based off of The Legend of Zelda",
              },
              {
                id: newId("b"),
                text: "Developed a game in Java to test the generated dungeons",
              },
              {
                id: newId("b"),
                text: "Contributed 50K+ lines of code to an established codebase via Git",
              },
              {
                id: newId("b"),
                text: "Conducted a human subject study to determine which video game dungeon generation technique is enjoyable",
              },
              {
                id: newId("b"),
                text: "Wrote an 8-page paper in tandem with the study and presented findings on campus",
              },
            ],
          },
        ],
      },
      {
        id: newId("s"),
        kind: "projects",
        title: "Projects",
        items: [
          {
            id: newId("i"),
            heading: "Gitlytics",
            subheading: "Python, Flask, React, PostgreSQL, Docker",
            dateRange: "June 2020 -- Present",
            bullets: [
              {
                id: newId("b"),
                text: "Developed a full-stack web application using Flask serving a REST API with React as the frontend",
              },
              {
                id: newId("b"),
                text: "Implemented GitHub OAuth to authenticate users and tracked their commit history",
              },
              {
                id: newId("b"),
                text: "Visualized GitHub data to show collaboration",
              },
              {
                id: newId("b"),
                text: "Used Celery and Redis for asynchronous task queuing",
              },
            ],
          },
          {
            id: newId("i"),
            heading: "Simple Paintball",
            subheading: "Spigot API, Java, Maven, TravisCI, Git",
            dateRange: "May 2018 -- May 2020",
            bullets: [
              {
                id: newId("b"),
                text: "Developed a Minecraft server plugin to entertain kids during free time for a previous job",
              },
              {
                id: newId("b"),
                text: "Published plugin to websites gaining 2K+ downloads and an average 4.5/5-star review",
              },
              {
                id: newId("b"),
                text: "Implemented continuous delivery using TravisCI to build the plugin upon new a release",
              },
              {
                id: newId("b"),
                text: "Collaborated with Minecraft server administrators to suggest features and get feedback about the plugin",
              },
            ],
          },
        ],
      },
      {
        id: newId("s"),
        kind: "skills",
        title: "Technical Skills",
        items: [
          {
            id: newId("i"),
            heading: "Languages",
            bullets: [
              {
                id: newId("b"),
                text: "Java, Python, C/C++, SQL (Postgres), JavaScript, HTML/CSS, R",
              },
            ],
          },
          {
            id: newId("i"),
            heading: "Frameworks",
            bullets: [
              {
                id: newId("b"),
                text: "React, Node.js, Flask, JUnit, WordPress, Material-UI, FastAPI",
              },
            ],
          },
          {
            id: newId("i"),
            heading: "Developer Tools",
            bullets: [
              {
                id: newId("b"),
                text: "Git, Docker, TravisCI, Google Cloud Platform, VS Code, Visual Studio, PyCharm, IntelliJ, Eclipse",
              },
            ],
          },
          {
            id: newId("i"),
            heading: "Libraries",
            bullets: [
              { id: newId("b"), text: "pandas, NumPy, Matplotlib" },
            ],
          },
        ],
      },
    ],
  };
}
