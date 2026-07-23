import React from 'react';

const App = () => {
  return (
    <main>
      <header>
        <nav aria-label="Main navigation">
          <div className="nav-container">
            <div className="logo">ShoeGun</div>
            <ul>
              <li><a href="#about">About</a></li>
              <li><a href="#projects">Projects</a></li>
              <li><a href="#contact">Contact</a></li>
            </ul>
          </div>
        </nav>
        <section aria-labelledby="portfolio-title">
          <h1 id="portfolio-title">Richard Jones</h1>
          <p>Building applied analytics, automation, and local AI systems with a bias toward useful, inspectable software.</p>
          <button type="button">Launch local AI</button>
        </section>
      </header>
      
      <section id="about" className="section">
        <h2>About</h2>
        <p>Analytics & Engineering Portfolio</p>
      </section>
      
      <section id="projects" className="section">
        <h2>Projects</h2>
        <div className="project-grid">
          <div className="project-card">Project 1</div>
          <div className="project-card">Project 2</div>
          <div className="project-card">Project 3</div>
        </div>
      </section>
      
      <section id="contact" className="section">
        <h2>Contact</h2>
        <p>Email: richard@example.com | LinkedIn: linkedin.com/in/richardjones</p>
      </section>
    </main>
  );
};

export default App;