/**
 * Dictionnaire de compétences (README §40).
 * - `aliases` : écritures reconnues (comparées sans accents, en minuscules).
 * - `caseSensitiveAliases` : écritures ambiguës en français, reconnues seulement avec la majuscule
 *   (ex. « Vue » oui, « en vue de » non).
 * - `family` : sert à reconnaître une techno PROCHE (Vue ≠ React, mais même famille JavaScript).
 * - `core` : langage ou framework principal. Les outils (Docker, SQL, Git...) ne pèsent pas
 *   dans la couverture technique, pour ne pas pénaliser une annonce qui liste beaucoup d'outils.
 */

export type SkillFamily =
  | "javascript"
  | "jvm"
  | "dotnet"
  | "python"
  | "php"
  | "native"
  | "mobile"
  | "go"
  | "rust"
  | "ruby"
  | "data"
  | "devops"
  | "frontend-tools"
  | "api"
  | "testing"
  | "other";

export type Skill = {
  id: string;
  label: string;
  family: SkillFamily;
  core: boolean;
  aliases: string[];
  caseSensitiveAliases?: string[];
};

export const SKILLS: Skill[] = [
  // JavaScript
  { id: "javascript", label: "JavaScript", family: "javascript", core: true, aliases: ["javascript", "ecmascript", "es6", "vanilla js"] },
  { id: "typescript", label: "TypeScript", family: "javascript", core: true, aliases: ["typescript"] },
  { id: "vue", label: "Vue.js", family: "javascript", core: true, aliases: ["vue.js", "vuejs", "vue js", "vu.js", "vue 2", "vue 3", "vue2", "vue3"], caseSensitiveAliases: ["Vue", "VueJS", "VUE"] },
  { id: "nuxt", label: "Nuxt", family: "javascript", core: true, aliases: ["nuxt", "nuxtjs", "nuxt.js"] },
  { id: "react", label: "React", family: "javascript", core: true, aliases: ["react", "reactjs", "react.js"] },
  { id: "nextjs", label: "Next.js", family: "javascript", core: true, aliases: ["next.js", "nextjs"] },
  { id: "angular", label: "Angular", family: "javascript", core: true, aliases: ["angular", "angularjs"] },
  { id: "svelte", label: "Svelte", family: "javascript", core: true, aliases: ["svelte", "sveltekit"] },
  { id: "node", label: "Node.js", family: "javascript", core: true, aliases: ["node.js", "nodejs", "node js", "node"] },
  { id: "express", label: "Express", family: "javascript", core: true, aliases: ["expressjs", "express.js"], caseSensitiveAliases: ["Express"] },
  { id: "nestjs", label: "NestJS", family: "javascript", core: true, aliases: ["nestjs", "nest.js"] },
  { id: "jquery", label: "jQuery", family: "javascript", core: true, aliases: ["jquery"] },
  { id: "ember", label: "Ember.js", family: "javascript", core: true, aliases: ["ember.js", "emberjs"] },
  { id: "fastify", label: "Fastify", family: "javascript", core: true, aliases: ["fastify"] },

  // JVM
  { id: "java", label: "Java", family: "jvm", core: true, aliases: ["java", "jee", "java ee", "jakarta ee", "j2ee"] },
  { id: "spring", label: "Spring Boot", family: "jvm", core: true, aliases: ["spring boot", "springboot", "spring framework", "spring"] },
  { id: "kotlin", label: "Kotlin", family: "jvm", core: true, aliases: ["kotlin"] },
  { id: "hibernate", label: "Hibernate", family: "jvm", core: false, aliases: ["hibernate", "jpa"] },
  { id: "struts", label: "Struts", family: "jvm", core: true, aliases: ["struts", "struts2", "struts 2"] },
  { id: "quarkus", label: "Quarkus", family: "jvm", core: true, aliases: ["quarkus"] },
  { id: "jsp", label: "JSP", family: "jvm", core: false, aliases: ["jsp", "jstl"] },
  { id: "appserver", label: "Tomcat / JBoss / WebSphere", family: "jvm", core: false, aliases: ["tomcat", "jboss", "wildfly", "jboss/wildfly", "websphere", "weblogic"] },
  { id: "maven", label: "Maven", family: "jvm", core: false, aliases: ["maven"] },
  { id: "gradle", label: "Gradle", family: "jvm", core: false, aliases: ["gradle"] },

  // .NET
  { id: "csharp", label: "C#", family: "dotnet", core: true, aliases: ["c#", "csharp", "c sharp"] },
  { id: "dotnet", label: ".NET", family: "dotnet", core: true, aliases: [".net", "dotnet", "asp.net", ".net core", "asp.net core", "blazor"] },
  { id: "wpf", label: "WPF", family: "dotnet", core: true, aliases: ["wpf"] },
  { id: "wcf", label: "WCF", family: "dotnet", core: true, aliases: ["wcf"] },
  { id: "efcore", label: "Entity Framework", family: "dotnet", core: false, aliases: ["entity framework", "ef core", "dapper"] },
  { id: "dotnet-ui", label: "DevExtreme / Telerik / Syncfusion", family: "dotnet", core: false, aliases: ["devextreme", "devexpress", "telerik", "syncfusion"] },

  // Autres langages
  { id: "python", label: "Python", family: "python", core: true, aliases: ["python"] },
  { id: "django", label: "Django", family: "python", core: true, aliases: ["django"] },
  { id: "flask", label: "Flask", family: "python", core: true, aliases: ["flask"] },
  { id: "fastapi", label: "FastAPI", family: "python", core: true, aliases: ["fastapi"] },
  { id: "php", label: "PHP", family: "php", core: true, aliases: ["php"] },
  { id: "symfony", label: "Symfony", family: "php", core: true, aliases: ["symfony"] },
  { id: "laravel", label: "Laravel", family: "php", core: true, aliases: ["laravel"] },
  { id: "cpp", label: "C++", family: "native", core: true, aliases: ["c++", "cpp"] },
  { id: "c", label: "C", family: "native", core: true, aliases: ["langage c", "c/c++"] },
  // Plateformes et langages de niche : souvent LA stack principale d'une annonce (« Développeur Windev »).
  { id: "windev", label: "WinDev", family: "other", core: true, aliases: ["windev", "webdev", "wlangage", "pc soft"] },
  { id: "delphi", label: "Delphi", family: "other", core: true, aliases: ["delphi"] },
  { id: "cobol", label: "COBOL", family: "other", core: true, aliases: ["cobol"] },
  { id: "abap", label: "SAP / ABAP", family: "other", core: true, aliases: ["abap", "sap s/4hana", "s/4hana", "sap hana", "sap fiori"] },
  { id: "salesforce", label: "Salesforce", family: "other", core: true, aliases: ["salesforce", "apex", "lightning web components"] },
  { id: "servicenow", label: "ServiceNow", family: "other", core: true, aliases: ["servicenow"] },
  { id: "3dexperience", label: "3DEXPERIENCE", family: "other", core: true, aliases: ["3dexperience", "3d experience", "enovia"] },
  { id: "apriso", label: "DELMIA Apriso", family: "other", core: true, aliases: ["apriso", "delmia apriso"] },
  { id: "powerplatform", label: "Power Platform", family: "other", core: true, aliases: ["power platform", "power apps", "powerapps", "power automate"] },
  { id: "dynamics", label: "Dynamics 365", family: "other", core: true, aliases: ["dynamics 365", "dynamics crm", "dynamics ax", "business central"] },
  { id: "pega", label: "Pega", family: "other", core: true, aliases: ["pega", "pegasystems"] },
  { id: "vba", label: "VBA", family: "other", core: true, aliases: ["vba", "visual basic"] },
  { id: "calypso", label: "Calypso", family: "other", core: true, aliases: ["calypso"] },
  { id: "murex", label: "Murex", family: "other", core: true, aliases: ["murex"] },
  { id: "uipath", label: "UiPath", family: "other", core: true, aliases: ["uipath"] },
  { id: "forgerock", label: "ForgeRock / IAM", family: "other", core: true, aliases: ["forgerock", "openidm", "sailpoint", "okta"] },
  { id: "scala", label: "Scala", family: "jvm", core: true, aliases: ["scala"] },
  { id: "groovy", label: "Groovy", family: "jvm", core: true, aliases: ["groovy", "grails"] },
  { id: "elixir", label: "Elixir", family: "other", core: true, aliases: ["elixir", "phoenix framework"] },
  { id: "perl", label: "Perl", family: "other", core: true, aliases: ["perl"] },
  { id: "objc", label: "Objective-C", family: "mobile", core: true, aliases: ["objective-c", "objective c"] },
  { id: "unity", label: "Unity", family: "other", core: true, aliases: ["unity3d", "unity 3d"], caseSensitiveAliases: ["Unity"] },
  { id: "wordpress", label: "WordPress", family: "php", core: true, aliases: ["wordpress", "woocommerce"] },
  { id: "drupal", label: "Drupal", family: "php", core: true, aliases: ["drupal"] },
  { id: "magento", label: "Magento", family: "php", core: true, aliases: ["magento", "adobe commerce"] },
  { id: "odoo", label: "Odoo", family: "python", core: true, aliases: ["odoo"] },
  { id: "go", label: "Go", family: "go", core: true, aliases: ["golang"] },
  { id: "rust", label: "Rust", family: "rust", core: true, aliases: ["rust"] },
  { id: "ruby", label: "Ruby", family: "ruby", core: true, aliases: ["ruby", "ruby on rails", "rails"] },

  // Mobile
  { id: "flutter", label: "Flutter", family: "mobile", core: true, aliases: ["flutter"] },
  { id: "dart", label: "Dart", family: "mobile", core: true, aliases: ["dart"] },
  { id: "swift", label: "Swift", family: "mobile", core: true, aliases: ["swift", "swiftui"] },
  { id: "react-native", label: "React Native", family: "mobile", core: true, aliases: ["react native", "react-native"] },
  { id: "android", label: "Android", family: "mobile", core: true, aliases: ["android"] },
  { id: "ios", label: "iOS", family: "mobile", core: true, aliases: [], caseSensitiveAliases: ["iOS"] },

  // Données
  { id: "sql", label: "SQL", family: "data", core: false, aliases: ["sql", "t-sql", "tsql", "sgbd", "sgbdr", "base de donnees relationnelle", "bases de donnees relationnelles"] },
  { id: "nosql", label: "NoSQL", family: "data", core: false, aliases: ["nosql", "cassandra", "dynamodb", "influxdb", "couchbase"] },
  { id: "elk", label: "Elasticsearch / ELK", family: "data", core: false, aliases: ["elasticsearch", "elastic search", "elk", "kibana", "elastic stack", "logstash", "opensearch"] },
  { id: "bigdata", label: "Spark / Hadoop", family: "data", core: false, aliases: ["spark", "apache spark", "pyspark", "hadoop", "databricks", "airflow"] },
  { id: "bigquery", label: "BigQuery", family: "data", core: false, aliases: ["bigquery", "snowflake", "redshift"] },
  { id: "powerbi", label: "Power BI", family: "data", core: false, aliases: ["power bi", "powerbi", "looker studio", "tableau software"] },
  { id: "pandas", label: "Pandas", family: "data", core: false, aliases: ["pandas", "numpy", "scikit-learn"] },
  { id: "messaging", label: "RabbitMQ / ActiveMQ", family: "data", core: false, aliases: ["rabbitmq", "activemq", "websphere mq", "ibm mq", "amqp"] },
  { id: "kafka", label: "Kafka", family: "data", core: false, aliases: ["kafka", "confluent kafka"] },
  { id: "postgresql", label: "PostgreSQL", family: "data", core: false, aliases: ["postgresql", "postgres"] },
  { id: "mysql", label: "MySQL", family: "data", core: false, aliases: ["mysql", "mariadb"] },
  { id: "oracle", label: "Oracle", family: "data", core: false, aliases: ["oracle", "pl/sql", "plsql"] },
  { id: "mongodb", label: "MongoDB", family: "data", core: false, aliases: ["mongodb", "mongo"] },
  { id: "redis", label: "Redis", family: "data", core: false, aliases: ["redis"] },

  // DevOps
  { id: "docker", label: "Docker", family: "devops", core: false, aliases: ["docker", "docker compose", "docker-compose"] },
  { id: "kubernetes", label: "Kubernetes", family: "devops", core: false, aliases: ["kubernetes", "k8s"] },
  { id: "git", label: "Git", family: "devops", core: false, aliases: ["git", "github"] },
  { id: "gitlab", label: "GitLab", family: "devops", core: false, aliases: ["gitlab", "gitlab ci", "gitlab-ci"] },
  { id: "cicd", label: "CI/CD", family: "devops", core: false, aliases: ["ci/cd", "ci cd", "integration continue", "jenkins"] },
  { id: "aws", label: "AWS", family: "devops", core: false, aliases: ["aws", "amazon web services"] },
  { id: "azure", label: "Azure", family: "devops", core: false, aliases: ["azure"] },
  { id: "gcp", label: "GCP", family: "devops", core: false, aliases: ["gcp", "google cloud"] },
  { id: "linux", label: "Linux", family: "devops", core: false, aliases: ["linux", "unix"] },
  { id: "shell", label: "Bash / PowerShell", family: "devops", core: false, aliases: ["bash", "powershell", "shell scripting", "scripts shell"] },
  { id: "terraform", label: "Terraform / Ansible", family: "devops", core: false, aliases: ["terraform", "ansible", "infrastructure as code", "pulumi"] },
  { id: "monitoring", label: "Grafana / Prometheus / Datadog", family: "devops", core: false, aliases: ["grafana", "prometheus", "datadog", "dynatrace", "opentelemetry", "sentry", "new relic"] },
  { id: "openshift", label: "OpenShift / Helm / ArgoCD", family: "devops", core: false, aliases: ["openshift", "argocd", "argo cd"], caseSensitiveAliases: ["Helm"] },
  { id: "sonar", label: "SonarQube", family: "devops", core: false, aliases: ["sonarqube", "sonar", "sonarcloud"] },
  { id: "webserver", label: "Nginx / IIS", family: "devops", core: false, aliases: ["nginx"], caseSensitiveAliases: ["IIS"] },
  { id: "jira", label: "Jira / Confluence", family: "devops", core: false, aliases: ["jira", "confluence"] },

  // Outils front
  { id: "html", label: "HTML", family: "frontend-tools", core: false, aliases: ["html", "html5"] },
  { id: "css", label: "CSS", family: "frontend-tools", core: false, aliases: ["css", "css3", "sass", "scss"] },
  { id: "tailwind", label: "Tailwind CSS", family: "frontend-tools", core: false, aliases: ["tailwind", "tailwindcss"] },
  { id: "vuetify", label: "Vuetify", family: "frontend-tools", core: false, aliases: ["vuetify"] },
  { id: "pinia", label: "Pinia", family: "frontend-tools", core: false, aliases: ["pinia", "vuex"] },
  { id: "redux", label: "Redux", family: "frontend-tools", core: false, aliases: ["redux", "zustand", "rxjs", "ngrx", "tanstack query", "react query"] },
  { id: "bootstrap", label: "Bootstrap", family: "frontend-tools", core: false, aliases: ["bootstrap"] },
  { id: "bundler", label: "Vite / Webpack", family: "frontend-tools", core: false, aliases: ["vitejs", "vite.js", "webpack", "babel", "esbuild"], caseSensitiveAliases: ["Vite"] },
  { id: "storybook", label: "Storybook", family: "frontend-tools", core: false, aliases: ["storybook"] },
  { id: "figma", label: "Figma", family: "frontend-tools", core: false, aliases: ["figma"] },
  { id: "dataviz", label: "WebGL / cartes / graphiques", family: "frontend-tools", core: false, aliases: ["webgl", "maplibre", "mapbox", "leaflet", "deck.gl", "deck gl", "echarts", "d3.js", "three.js", "chart.js"] },

  // API
  { id: "rest", label: "API REST", family: "api", core: false, aliases: ["api rest", "rest api", "rest apis", "apis rest", "restful", "api restful", "web api", "web apis", "openapi", "swagger"] },
  { id: "soap", label: "SOAP", family: "api", core: false, aliases: ["soap"] },
  { id: "websocket", label: "WebSocket", family: "api", core: false, aliases: ["websocket", "websockets", "socket.io"] },
  { id: "trpc", label: "tRPC", family: "api", core: false, aliases: ["trpc"] },
  { id: "graphql", label: "GraphQL", family: "api", core: false, aliases: ["graphql"] },
  { id: "grpc", label: "gRPC", family: "api", core: false, aliases: ["grpc", "protocol buffers", "protobuf"] },
  { id: "auth", label: "JWT / OAuth", family: "api", core: false, aliases: ["jwt", "json web token", "oauth", "oauth2", "openid connect", "auth0", "keycloak"] },
  { id: "microservices", label: "Microservices", family: "other", core: false, aliases: ["microservices", "micro-services", "micro services"] },
  { id: "archi", label: "DDD / CQRS / Clean Architecture", family: "other", core: false, aliases: ["ddd", "domain driven design", "cqrs", "clean architecture", "architecture hexagonale"] },

  // Tests
  { id: "jest", label: "Jest", family: "testing", core: false, aliases: ["jest"] },
  { id: "vitest", label: "Vitest", family: "testing", core: false, aliases: ["vitest"] },
  { id: "cypress", label: "Cypress", family: "testing", core: false, aliases: ["cypress"] },
  { id: "playwright", label: "Playwright", family: "testing", core: false, aliases: ["playwright"] },
  { id: "junit", label: "JUnit", family: "testing", core: false, aliases: ["junit", "mockito"] },
  { id: "selenium", label: "Selenium / Cucumber", family: "testing", core: false, aliases: ["selenium", "cucumber", "postman", "karate dsl"], caseSensitiveAliases: ["Karate"] },

  // IA (outils, pas une stack : une annonce sans eux n'est pas pénalisée). « claude » et « cursor » seuls : prénom, curseur.
  { id: "agents-ia", label: "Développement assisté par agents IA", family: "other", core: false, aliases: ["claude code", "cursor ai", "cursor ide", "agents de code ia", "agent de code ia", "agents ia", "agent ia", "agents d'ia", "ai coding agents", "ai coding agent", "ai coding assistant", "developpement augmente par l'ia", "developpement assiste par l'ia", "developpement assiste par ia", "github copilot", "copilot", "openai codex", "agentic engineering", "agentic coding", "vibe coding", "ia appliquee au developpement", "intelligence artificielle appliquee au developpement", "developpement avec l'ia", "coder avec l'ia"], caseSensitiveAliases: ["Cursor", "Codex"] },
  { id: "mcp", label: "MCP et hooks Claude Code", family: "other", core: false, aliases: ["model context protocol", "serveur mcp", "serveurs mcp", "mcp server", "mcp servers", "claude code hooks", "hooks claude code"], caseSensitiveAliases: ["MCP"] },
  { id: "multi-agents", label: "Orchestration d'agents IA", family: "other", core: false, aliases: ["orchestration d'agents", "orchestration d'agents ia", "orchestration multi agents", "multi agents", "multi agent", "systemes multi agents", "multi agent systems", "agent orchestration"] },
  { id: "llm-api", label: "API de LLM (Claude, Mistral, Groq)", family: "other", core: false, aliases: ["llm", "llms", "ia generative", "intelligence artificielle generative", "genai", "gen ai", "generative ai", "anthropic", "claude ai", "api claude", "mistral ai", "api mistral", "groq", "langchain", "llamaindex", "openai", "pinecone"], caseSensitiveAliases: ["RAG"] },
  { id: "garde-fous-ia", label: "Garde-fous IA et validation humaine", family: "other", core: false, aliases: ["garde fous", "garde fou", "guardrails", "human in the loop", "validation humaine", "zod"] },
];

export const SKILLS_BY_ID = new Map(SKILLS.map((s) => [s.id, s]));
