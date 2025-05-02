---
title: Rust Software Engineer @Qwant (Cralwer Team)
employer:
  name: Qwant
  link: https://www.qwant.com/
startDate: 2022-12-13
endDate: 2025-04-01
tools:
  - rust
  - kubernetes
  - python
description: |
  As a Rust Software Engineer at Qwant, one of Europe's leading search engines, I focus on developing and optimizing web-scale crawling systems and content processing pipelines.</br>
  My significant contributions include developing a high-performance HTML content extraction service that matches the quality of industry standards while operating at substantially faster speeds. I architected a sharded, lock-free crawling system that dramatically improved performance while maintaining strict website politeness policies. The system includes sophisticated robots.txt handling with caching and parsing capabilities for URL filtering.<br/>
  My work extends across the crawler's core infrastructure, encompassing URL redirection management, filtering systems, and comprehensive end-to-end testing, all contributing to Qwant's robust search engine infrastructure.
---

I'm working on core infrastructure for one of Europe's leading search engines, specializing in web-scale crawling systems and content processing pipelines using Rust.

### Key Contributions:

- I implemented a high-performance HTML content extraction microservice that extracts clean text from web documents at scale, achieving quality metrics comparable to industry-standard solutions like Trafilatura while delivering several orders of magnitude faster processing speeds.

- I enhanced our crawler's throughput through a sharded, lock-free architecture that maintains strict politeness policies (ensuring no more than one concurrent download per website). This architectural redesign resulted in multiple orders of magnitude improvement in crawling performance.

- I implemented a microservice to download, cache and parse robots.txt file and filter URLs based on rules defined in these files.

- I worked on a number of the crawler's core features: URL redirection management, URL filtering, end-to-end tests ...
