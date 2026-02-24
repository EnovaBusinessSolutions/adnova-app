// Merge
cd adnova-app
git branch --show-current
git checkout german/dev
git fetch origin
git merge origin/main
git push

// Pull de dashboard
cd dashboard-src
git checkout german/dev
git pull

// Commit en principal
git add .
git commit -m "test: german staging push"
git push

// Commit en submódulos
npm run build
git add .
git commit -m"mod init"
git push