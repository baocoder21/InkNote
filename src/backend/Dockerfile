# The InkNote API image. Build from THIS folder:  docker build -t inknote-api src/backend
#
# Two stages ("multi-stage build"): the first has the whole .NET SDK (compilers, ~1 GB) and builds the app, the second has
# only the small ASP.NET runtime and receives the published result. The SDK, the source code and the test project never
# reach the final image.

# ---- stage 1: build ----
FROM mcr.microsoft.com/dotnet/sdk:9.0 AS build
WORKDIR /src

# Copy ONLY the project file and restore packages first: Docker caches each step, so as long as the packages did not change,
# a rebuild after editing C# code skips the (slow) download.
COPY InkNote.Api/InkNote.Api.csproj InkNote.Api/
RUN dotnet restore InkNote.Api/InkNote.Api.csproj

COPY InkNote.Api/ InkNote.Api/
RUN dotnet publish InkNote.Api/InkNote.Api.csproj -c Release -o /app --no-restore /p:UseAppHost=false

# ---- stage 2: run ----
FROM mcr.microsoft.com/dotnet/aspnet:9.0 AS runtime
WORKDIR /app
COPY --from=build /app .

# Listens on 8080 (the default of the .NET 8+ images, a port above 1024 so no root is needed) and runs as the
# non-root user "app" that the image provides: a bug in the app then cannot do what root could.
ENV ASPNETCORE_ENVIRONMENT=Production
USER $APP_UID
EXPOSE 8080

ENTRYPOINT ["dotnet", "InkNote.Api.dll"]
