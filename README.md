# Kimochi

This is a monorepo that contains the code for my [personal webpage](https://jonhor.de), but also Ansible playbooks a Helm chart and other k8s resources to enable a GitOps workflow.

## Project Structure

`website/` contains the actual Astro website code.\
`ansible/` provides some Ansible playbooks to configure a server with a k3s cluster.\
`deploy/` contains k8s resources to configure Flux CD.\
`helm/` contains a Helm chart that manages website releases to the cluster.

## Website

When inside `website/`, you can do the following.

Run dev server with hot reload 
```sh
npm run dev
```

Build the website for release
```sh
npm run build
```

Create a container with the provided `Dockerfile`.


