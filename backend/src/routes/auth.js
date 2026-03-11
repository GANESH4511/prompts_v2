const express = require('express');
const router = express.Router();
const bcrypt = require('bcryptjs');
const { prisma } = require('../lib/prisma');
const { generateToken, generateRefreshToken, verifyToken, authenticateToken } = require('../middleware/auth');

// Salt rounds for bcrypt
const SALT_ROUNDS = 12;

/**
 * Hash password using bcrypt
 * @param {string} password - Plain text password
 * @returns {Promise<string>} Hashed password
 */
const hashPassword = async (password) => {
    return await bcrypt.hash(password, SALT_ROUNDS);
};

/**
 * Compare password with hash
 * @param {string} password - Plain text password
 * @param {string} hash - Hashed password
 * @returns {Promise<boolean>} Whether password matches
 */
const comparePassword = async (password, hash) => {
    return await bcrypt.compare(password, hash);
};

// ==========================================
// POST /api/auth/login - User login
// ==========================================
router.post('/login', async (req, res) => {
    console.log('\n📧 Login attempt received');

    try {
        const { email, password } = req.body;
        console.log('   Email:', email);

        // Validate input
        if (!email || !password) {
            console.log('❌ Missing email or password');
            return res.status(400).json({
                success: false,
                message: 'Email and password are required'
            });
        }

        // Find user by email
        console.log('🔍 Looking up user in database...');
        let user = await prisma.user.findUnique({
            where: { email: email.toLowerCase() }
        });

        // If no users exist, create default users (for initial setup)
        if (!user) {
            const userCount = await prisma.user.count();

            if (userCount === 0) {
                console.log('📝 Creating default users for initial setup...');

                const defaultUsers = [
                    {
                        email: 'admin@hrassist.com',
                        password: await hashPassword('admin123'),
                        name: 'Admin User',
                        role: 'admin'
                    },
                    {
                        email: 'user@hrassist.com',
                        password: await hashPassword('user123'),
                        name: 'Regular User',
                        role: 'user'
                    }
                ];

                for (const defaultUser of defaultUsers) {
                    await prisma.user.upsert({
                        where: { email: defaultUser.email },
                        update: {},
                        create: defaultUser
                    });
                }

                // Try to find user again
                user = await prisma.user.findUnique({
                    where: { email: email.toLowerCase() }
                });
            }
        }

        // User not found
        if (!user) {
            console.log('❌ User not found:', email);
            return res.status(401).json({
                success: false,
                message: 'Invalid email or password'
            });
        }

        console.log('✅ User found:', user.email);

        // Check if password is hashed (bcrypt hashes start with $2)
        let passwordValid;
        if (user.password.startsWith('$2')) {
            // Password is hashed - use bcrypt compare
            passwordValid = await comparePassword(password, user.password);
        } else {
            // Password is plain text (legacy) - compare directly and then hash it
            passwordValid = user.password === password;

            if (passwordValid) {
                // Upgrade to hashed password
                const hashedPassword = await hashPassword(password);
                await prisma.user.update({
                    where: { id: user.id },
                    data: { password: hashedPassword }
                });
                console.log(`🔐 Upgraded password hash for user: ${user.email}`);
            }
        }

        if (!passwordValid) {
            console.log('❌ Invalid password for user:', user.email);
            return res.status(401).json({
                success: false,
                message: 'Invalid email or password'
            });
        }

        console.log('✅ Password validated for user:', user.email);

        // Generate JWT tokens
        console.log('🎫 Generating tokens...');
        const accessToken = generateToken(user);
        const refreshToken = generateRefreshToken(user);

        console.log('✅ Login successful for:', user.email);

        // Return success response
        res.json({
            success: true,
            message: 'Login successful',
            accessToken,
            refreshToken,
            // Also include 'token' for backwards compatibility
            token: accessToken,
            user: {
                id: user.id,
                email: user.email,
                name: user.name,
                role: user.role
            }
        });

    } catch (error) {
        console.error('Login error:', error);
        res.status(500).json({
            success: false,
            message: 'Internal server error'
        });
    }
});

// ==========================================
// POST /api/auth/register - User registration
// ==========================================
router.post('/register', async (req, res) => {
    try {
        const { email, password, name } = req.body;

        // Validate input
        if (!email || !password || !name) {
            return res.status(400).json({
                success: false,
                message: 'Email, password, and name are required'
            });
        }

        // Validate email format
        const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
        if (!emailRegex.test(email)) {
            return res.status(400).json({
                success: false,
                message: 'Invalid email format'
            });
        }

        // Validate password strength
        if (password.length < 6) {
            return res.status(400).json({
                success: false,
                message: 'Password must be at least 6 characters long'
            });
        }

        // Check if user already exists
        const existingUser = await prisma.user.findUnique({
            where: { email: email.toLowerCase() }
        });

        if (existingUser) {
            return res.status(400).json({
                success: false,
                message: 'Email already registered'
            });
        }

        // Hash password
        const hashedPassword = await hashPassword(password);

        // Create new user
        const user = await prisma.user.create({
            data: {
                email: email.toLowerCase(),
                password: hashedPassword,
                name: name.trim(),
                role: 'user'
            }
        });

        // Generate tokens
        const accessToken = generateToken(user);
        const refreshToken = generateRefreshToken(user);

        res.status(201).json({
            success: true,
            message: 'Registration successful',
            accessToken,
            refreshToken,
            token: accessToken,
            user: {
                id: user.id,
                email: user.email,
                name: user.name,
                role: user.role
            }
        });

    } catch (error) {
        console.error('Registration error:', error);
        res.status(500).json({
            success: false,
            message: 'Internal server error'
        });
    }
});

// ==========================================
// POST /api/auth/refresh - Refresh access token
// ==========================================
router.post('/refresh', async (req, res) => {
    try {
        const { refreshToken } = req.body;

        if (!refreshToken) {
            return res.status(400).json({
                success: false,
                message: 'Refresh token is required'
            });
        }

        // Verify refresh token
        const decoded = verifyToken(refreshToken);

        if (!decoded || decoded.type !== 'refresh') {
            return res.status(401).json({
                success: false,
                message: 'Invalid refresh token'
            });
        }

        // Find user
        const user = await prisma.user.findUnique({
            where: { id: decoded.id }
        });

        if (!user) {
            return res.status(401).json({
                success: false,
                message: 'User not found'
            });
        }

        // Generate new access token
        const accessToken = generateToken(user);

        res.json({
            success: true,
            accessToken,
            token: accessToken
        });

    } catch (error) {
        console.error('Token refresh error:', error);
        res.status(500).json({
            success: false,
            message: 'Internal server error'
        });
    }
});

// ==========================================
// POST /api/auth/verify - Verify token validity
// ==========================================
router.post('/verify', async (req, res) => {
    try {
        const { token } = req.body;

        // Also check Authorization header
        const authHeader = req.headers['authorization'];
        const headerToken = authHeader && authHeader.split(' ')[1];
        const tokenToVerify = token || headerToken;

        if (!tokenToVerify) {
            return res.status(400).json({
                success: false,
                message: 'Token is required'
            });
        }

        // Verify JWT token
        const decoded = verifyToken(tokenToVerify);

        if (!decoded) {
            return res.status(401).json({
                success: false,
                message: 'Invalid or expired token'
            });
        }

        // Find user
        const user = await prisma.user.findUnique({
            where: { id: decoded.id },
            select: {
                id: true,
                email: true,
                name: true,
                role: true
            }
        });

        if (!user) {
            return res.status(401).json({
                success: false,
                message: 'User not found'
            });
        }

        res.json({
            success: true,
            valid: true,
            user
        });

    } catch (error) {
        console.error('Token verification error:', error);
        res.status(401).json({
            success: false,
            message: 'Invalid token'
        });
    }
});

// ==========================================
// GET /api/auth/me - Get current user info
// ==========================================
router.get('/me', authenticateToken, async (req, res) => {
    try {
        res.json({
            success: true,
            user: req.user
        });
    } catch (error) {
        console.error('Get user error:', error);
        res.status(500).json({
            success: false,
            message: 'Internal server error'
        });
    }
});

// ==========================================
// PUT /api/auth/profile - Update user profile
// ==========================================
router.put('/profile', authenticateToken, async (req, res) => {
    try {
        const { name, currentPassword, newPassword } = req.body;
        const userId = req.user.id;

        const updateData = {};

        // Update name if provided
        if (name && name.trim()) {
            updateData.name = name.trim();
        }

        // Update password if provided
        if (newPassword) {
            if (!currentPassword) {
                return res.status(400).json({
                    success: false,
                    message: 'Current password is required to change password'
                });
            }

            // Get user with password
            const user = await prisma.user.findUnique({
                where: { id: userId }
            });

            // Verify current password
            const passwordValid = await comparePassword(currentPassword, user.password);

            if (!passwordValid) {
                return res.status(401).json({
                    success: false,
                    message: 'Current password is incorrect'
                });
            }

            // Validate new password
            if (newPassword.length < 6) {
                return res.status(400).json({
                    success: false,
                    message: 'New password must be at least 6 characters'
                });
            }

            updateData.password = await hashPassword(newPassword);
        }

        // Update user
        if (Object.keys(updateData).length > 0) {
            await prisma.user.update({
                where: { id: userId },
                data: updateData
            });
        }

        // Get updated user
        const updatedUser = await prisma.user.findUnique({
            where: { id: userId },
            select: {
                id: true,
                email: true,
                name: true,
                role: true
            }
        });

        res.json({
            success: true,
            message: 'Profile updated successfully',
            user: updatedUser
        });

    } catch (error) {
        console.error('Profile update error:', error);
        res.status(500).json({
            success: false,
            message: 'Internal server error'
        });
    }
});

// ==========================================
// POST /api/auth/logout - Logout user
// ==========================================
router.post('/logout', (req, res) => {
    // With JWT, logout is handled client-side by removing the token
    // In production, you might want to implement a token blacklist
    res.json({
        success: true,
        message: 'Logged out successfully'
    });
});

// ==========================================
// POST /api/auth/change-password - Change password (admin)
// ==========================================
router.post('/change-password', authenticateToken, async (req, res) => {
    try {
        const { currentPassword, newPassword } = req.body;
        const userId = req.user.id;

        if (!currentPassword || !newPassword) {
            return res.status(400).json({
                success: false,
                message: 'Current and new password are required'
            });
        }

        // Get user with password
        const user = await prisma.user.findUnique({
            where: { id: userId }
        });

        // Verify current password
        let passwordValid;
        if (user.password.startsWith('$2')) {
            passwordValid = await comparePassword(currentPassword, user.password);
        } else {
            passwordValid = currentPassword === user.password;
        }

        if (!passwordValid) {
            return res.status(401).json({
                success: false,
                message: 'Current password is incorrect'
            });
        }

        // Validate new password
        if (newPassword.length < 6) {
            return res.status(400).json({
                success: false,
                message: 'New password must be at least 6 characters'
            });
        }

        // Update password
        const hashedPassword = await hashPassword(newPassword);
        await prisma.user.update({
            where: { id: userId },
            data: { password: hashedPassword }
        });

        res.json({
            success: true,
            message: 'Password changed successfully'
        });

    } catch (error) {
        console.error('Change password error:', error);
        res.status(500).json({
            success: false,
            message: 'Internal server error'
        });
    }
});

module.exports = router;
