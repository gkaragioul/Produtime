# ProduTime - Time Tracking & Productivity Monitoring

ProduTime is a comprehensive time tracking and productivity monitoring application built with Electron, React, and Node.js.

## 📚 Documentation

All documentation is organized in [`docs-root/`](docs-root/):

### Getting Started
- **[QUICK_START_GUIDE.md](docs-root/QUICK_START_GUIDE.md)** - Setup and first run
- **[DEVELOPER_ONBOARDING.md](docs-root/DEVELOPER_ONBOARDING.md)** - Developer guide

### Technical Reference
- **[TECHNICAL_DOCUMENTATION.md](docs-root/TECHNICAL_DOCUMENTATION.md)** - Complete technical overview
- **[DATABASE_SCHEMA_REFERENCE.md](docs-root/DATABASE_SCHEMA_REFERENCE.md)** - Database schema
- **[ARCHITECTURE_DIAGRAMS.md](docs-root/ARCHITECTURE_DIAGRAMS.md)** - System architecture

### Licensing System
- **[ENTITLEMENTS_IMPLEMENTATION.md](docs-root/ENTITLEMENTS_IMPLEMENTATION.md)** - Licensing implementation guide
- **[LICENSING_IMPLEMENTATION_INDEX.md](docs-root/LICENSING_IMPLEMENTATION_INDEX.md)** - Licensing navigation
- **[LICENSING_SYSTEM_GUIDE.md](docs-root/LICENSING_SYSTEM_GUIDE.md)** - Licensing system overview
- **[LICENSE_MANAGER_TECHNICAL_DOCUMENTATION.md](docs-root/LICENSE_MANAGER_TECHNICAL_DOCUMENTATION.md)** - License manager technical details

### Deployment
- **[PRODUCTION_DEPLOYMENT_CHECKLIST.md](docs-root/PRODUCTION_DEPLOYMENT_CHECKLIST.md)** - Pre-deployment checklist
- **[SYSTEM_AUDIT_REPORT.md](docs-root/SYSTEM_AUDIT_REPORT.md)** - System audit findings

## 🚀 Quick Start

### Prerequisites
- Node.js 18+
- npm 8+
- Windows 10+ (for development)

### Installation

```bash
# Install dependencies
npm install

# Build main process
npm run build:main

# Start development
npm start
```

### Admin Console

```bash
cd admin-console
npm install
npm run build
npm start
```

### Licensing Server

```bash
cd licensing-server/api
npm install
npm run build
npm start
```

## 📦 Project Structure

```
ProduTime/
├── src/                      # Main app (Electron + React)
│   ├── main/                 # Electron main process
│   ├── renderer/             # React UI
│   └── shared/               # Shared utilities
├── admin-console/            # Admin panel (Electron)
├── cloud-admin-api/          # Cloud API (Node.js/Fastify)
├── cloud-admin-web/          # Cloud web UI (React)
├── licensing-server/         # License manager (Fastify)
├── docs-root/                # Documentation
├── scripts/                  # Build scripts
└── assets/                   # Images and resources
```

## 🔐 Licensing

ProduTime v1.8.8+ uses an entitlements-based licensing system:

- **Feature-based access control** - Different plans unlock different features
- **Seat enforcement** - Limit devices per license
- **Time skew mitigation** - Handles clock changes safely
- **Revocation detection** - Real-time license invalidation
- **Grace period** - 72 hours offline operation
- **Tamper detection** - Prevents license theft

See [ENTITLEMENTS_IMPLEMENTATION.md](docs-root/ENTITLEMENTS_IMPLEMENTATION.md) for complete details.

## 🧪 Testing

```bash
# Run all tests
npm test

# Run specific test suite
npm test -- --testPathPattern=licensing

# Run simulation scenarios
node scripts/simulate-license-scenarios.js
```

## 🏗️ Building

```bash
# Build main process
npm run build:main

# Build renderer
npm run build:renderer

# Build for distribution
npm run dist:x64

# Build admin console
cd admin-console && npm run build
```

## 📋 Features

### ProduTime Client
- Real-time activity tracking
- Productivity metrics and reports
- PDF report generation
- Auto-export scheduler
- Privacy mode
- System tray integration
- Admin console connectivity

### Admin Console
- Device management
- Policy deployment
- Real-time monitoring
- Dashboard analytics
- Device pairing
- Audit logging

### Licensing
- Trial period (7 days)
- License activation
- Seat management
- Feature gating
- Revocation support
- Offline grace period

## 🔧 Development

### Environment Variables

Create `.env` file in root:

```bash
NODE_ENV=development
LICENSE_SERVER_URL=http://localhost:3000
ED25519_PUBLIC_KEY=your_public_key_here
```

### Debugging

```bash
# Enable debug logging
DEBUG=* npm start

# Open DevTools
npm start -- --dev
```

## 📝 Version History

## 📝 Version History

- **v1.8.9** - Hardened Production Release (Audited)
- **v1.8.8** - Entitlements-based licensing
- **v1.7.7** - Freemium release
- **v1.0.0** - Initial release

## 🤝 Contributing

1. Create a feature branch
2. Make your changes
3. Run tests: `npm test`
4. Submit a pull request

## 📄 License

See [LICENSE.txt](LICENSE.txt)

## 📞 Support

For issues and questions:
- Check [docs-root/](docs-root/) for documentation
- Review [SYSTEM_AUDIT_REPORT.md](docs-root/SYSTEM_AUDIT_REPORT.md) for known issues
- Check GitHub issues

---

**Version:** 1.8.9  
**Last Updated:** January 2026  
**Status:** Production Ready ✅
