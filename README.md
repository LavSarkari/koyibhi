# Omegle Clone

A real-time anonymous video and text chat application that allows users to connect with random strangers for conversations.

## Features

- Real-time video and text chat
- Anonymous communication
- Profanity filtering
- Rate limiting for security
- Cross-origin resource sharing support

## Technologies Used

- Node.js
- Express.js
- Socket.IO
- Various security middleware (cors, express-rate-limit)
- Content filtering (bad-words)

## Prerequisites

Before running this project, make sure you have:
- Node.js (v14 or higher)
- npm (Node Package Manager)

## Installation

1. Clone the repository:
```bash
git clone https://github.com/LavSarkari/koyibhi/
cd omegle-clone
```

2. Install dependencies:
```bash
npm install
```

3. Create a `.env` file in the root directory (if needed) and configure your environment variables.

## Running the Application

### Development Mode
To run the application in development mode with auto-reload:
```bash
npm run dev
```

### Production Mode
To run the application in production mode:
```bash
npm start
```

The application will start on `http://localhost:3000` (or your configured port).

## Project Structure

- `server.js` - Main application entry point and server configuration
- `public/` - Static files and client-side code
- `package.json` - Project dependencies and scripts

## Security Features

- Rate limiting to prevent abuse
- Profanity filtering for text chat
- CORS configuration for secure cross-origin requests

## Contributing

1. Fork the repository
2. Create your feature branch (`git checkout -b feature/AmazingFeature`)
3. Commit your changes (`git commit -m 'Add some AmazingFeature'`)
4. Push to the branch (`git push origin feature/AmazingFeature`)
5. Open a Pull Request

## License

This project is licensed under the MIT License - see the LICENSE file for details.

## Acknowledgments

- Inspired by Omegle
- Built with modern web technologies
- Focus on user privacy and security 
