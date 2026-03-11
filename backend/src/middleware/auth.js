const jwt = require('jsonwebtoken');
const { prisma } = require('../lib/prisma');

// JWT Secret - In production, use a secure secret stored in environment variables
const JWT_SECRET = process.env.JWT_SECRET || 'your-super-secret-jwt-key-change-in-production';
const JWT_EXPIRES_IN = process.env.JWT_EXPIRES_IN || '24h';

/**
 * Generate JWT Token
 * @param {Object} user - User object with id, email, role
 * @returns {string} JWT token
 */
const generateToken = (user) => {
    const payload = {
        id: user.id,
        email: user.email,
        name: user.name,
        role: user.role
    };

    return jwt.sign(payload, JWT_SECRET, {
        expiresIn: JWT_EXPIRES_IN
    });
};

/**
 * Generate Refresh Token (longer expiry)
 * @param {Object} user - User object with id
 * @returns {string} Refresh token
 */
const generateRefreshToken = (user) => {
    return jwt.sign(
        { id: user.id, type: 'refresh' },
        JWT_SECRET,
        { expiresIn: '7d' }
    );
};

/**
 * Verify JWT Token
 * @param {string} token - JWT token to verify
 * @returns {Object|null} Decoded payload or null if invalid
 */
const verifyToken = (token) => {
    try {
        const decoded = jwt.verify(token, JWT_SECRET);
        return decoded;
    } catch (error) {
        return null;
    }
};

/**
 * Authentication Middleware
 * Verifies JWT token from Authorization header
 */
const authenticateToken = async (req, res, next) => {
    try {
        // Get token from Authorization header
        const authHeader = req.headers['authorization'];
        const token = authHeader && authHeader.split(' ')[1]; // Bearer TOKEN

        if (!token) {
            return res.status(401).json({
                success: false,
                message: 'Access token is required',
                code: 'TOKEN_MISSING'
            });
        }

        // Verify token
        const decoded = verifyToken(token);

        if (!decoded) {
            return res.status(401).json({
                success: false,
                message: 'Invalid or expired token',
                code: 'TOKEN_INVALID'
            });
        }

        // Use JWT payload directly (name cached in token) — skip DB lookup
        // Only hit DB if critical fields are missing from token
        let user = {
            id: decoded.id,
            email: decoded.email,
            name: decoded.name,
            role: decoded.role
        };

        if (!user.email || !user.role) {
            // Fallback: token missing fields, fetch from DB
            const dbUser = await prisma.user.findUnique({
                where: { id: decoded.id },
                select: { id: true, email: true, name: true, role: true }
            });
            if (!dbUser) {
                return res.status(401).json({
                    success: false,
                    message: 'User no longer exists',
                    code: 'USER_NOT_FOUND'
                });
            }
            user = dbUser;
        }

        // Attach user to request object
        req.user = user;
        next();

    } catch (error) {
        console.error('❌ Authentication error:', error);
        return res.status(500).json({
            success: false,
            message: 'Authentication failed',
            code: 'AUTH_ERROR'
        });
    }
};

/**
 * Optional Authentication Middleware
 * If token is provided, validates it. If not, continues without user.
 */
const optionalAuth = async (req, res, next) => {
    try {
        const authHeader = req.headers['authorization'];
        const token = authHeader && authHeader.split(' ')[1];

        if (!token) {
            req.user = null;
            return next();
        }

        const decoded = verifyToken(token);

        if (decoded) {
            const user = await prisma.user.findUnique({
                where: { id: decoded.id },
                select: {
                    id: true,
                    email: true,
                    name: true,
                    role: true
                }
            });
            req.user = user;
        } else {
            req.user = null;
        }

        next();
    } catch (error) {
        req.user = null;
        next();
    }
};

/**
 * Role-based Authorization Middleware
 * @param {...string} roles - Allowed roles
 */
const requireRole = (...roles) => {
    return (req, res, next) => {
        if (!req.user) {
            return res.status(401).json({
                success: false,
                message: 'Authentication required',
                code: 'AUTH_REQUIRED'
            });
        }

        if (!roles.includes(req.user.role)) {
            return res.status(403).json({
                success: false,
                message: 'Insufficient permissions',
                code: 'FORBIDDEN'
            });
        }

        next();
    };
};

module.exports = {
    generateToken,
    generateRefreshToken,
    verifyToken,
    authenticateToken,
    optionalAuth,
    requireRole,
    JWT_SECRET
};
