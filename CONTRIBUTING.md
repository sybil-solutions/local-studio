# Contributing to vLLM Studio

Thank you for your interest in contributing to vLLM Studio!

## Getting Started

1. Fork the repository
2. Clone your fork: `git clone https://github.com/YOUR_USERNAME/vllm-studio.git`
3. Create a branch: `git checkout -b feature/your-feature`
4. Make your changes
5. Run checks/tests (as applicable):
   - `cd controller && bun test`
   - `cd frontend && npm run build`
6. Commit: `git commit -m "Add your feature"`
7. Push: `git push origin feature/your-feature`
8. Open a Pull Request

## Development Setup

### Controller (Bun/TypeScript)

```bash
# Run with auto-reload
./start.sh --dev
```

### Frontend (Next.js)

```bash
cd frontend
npm install
npm run dev
```

## Code Style

- **TypeScript**: We use ESLint and Prettier

## Pull Request Guidelines

1. Keep PRs focused on a single feature or fix
2. Write clear commit messages
3. Update documentation if needed
4. Add tests for new functionality

## Questions?

Open an issue for any questions or discussions.
